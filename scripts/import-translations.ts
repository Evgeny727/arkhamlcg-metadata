import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type ZodType, z } from "zod";
import { type Campaign, campaignSchema } from "../schemas/campaign.schema.ts";
import {
    type CampaignTranslation,
    campaignTranslationSchema,
} from "../schemas/campaign-translation.schema.ts";
import { type Scenario, scenarioSchema } from "../schemas/scenario.schema.ts";
import {
    type ScenarioTranslation,
    scenarioTranslationSchema,
} from "../schemas/scenario-translation.schema.ts";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const repository = "Kamalisk/arkhamdb-json-data";
const revision = "master";
const githubApiUrl = `https://api.github.com/repos/${repository}`;
const rawContentUrl = `https://raw.githubusercontent.com/${repository}/${revision}`;

const remoteNamedEntitySchema = z.object({
    code: z.string(),
    name: z.string(),
});

const translationDirectorySchema = z.object({
    name: z.string().regex(/^[a-z]{2}(?:-[a-z]{2})?$/),
    type: z.literal("dir"),
});

const translationDirectoryListSchema = z.array(
    z.object({
        name: z.string(),
        type: z.string(),
    }),
);

interface MultipartFormat {
    readonly partSuffix: string;
    readonly titleSuffix: string;
}

interface TranslationImport {
    readonly campaignOutputPath: string;
    readonly campaigns: readonly CampaignTranslation[];
    readonly locale: string;
    readonly scenarioOutputPath: string;
    readonly scenarios: readonly ScenarioTranslation[];
}

type RemoteNamedEntity = z.infer<typeof remoteNamedEntitySchema>;

const defaultMultipartFormat: MultipartFormat = {
    partSuffix: "",
    titleSuffix: ", Part ",
};

const multipartFormats: Readonly<Record<string, MultipartFormat>> = {
    de: { partSuffix: "", titleSuffix: ", Teil " },
    es: { partSuffix: "", titleSuffix: " parte " },
    fr: { partSuffix: "", titleSuffix: ", Partie " },
    it: { partSuffix: "", titleSuffix: ", Parte " },
    ko: { partSuffix: "부", titleSuffix: " " },
    pl: { partSuffix: "", titleSuffix: " część " },
    pt: { partSuffix: "", titleSuffix: ", Parte " },
    ru: { partSuffix: "", titleSuffix: ". Часть " },
    uk: { partSuffix: "", titleSuffix: ". Частина " },
    zh: { partSuffix: "部", titleSuffix: "，第" },
    "zh-cn": { partSuffix: "部", titleSuffix: "，第" },
};

await importTranslations();

async function importTranslations(): Promise<void> {
    const campaigns = readArrayFile(
        join(projectRoot, "campaigns/campaigns.json"),
        campaignSchema,
    );
    const scenarios = readArrayFile(
        join(projectRoot, "scenarios/scenarios.json"),
        scenarioSchema,
    );
    const cycles = await fetchJson(
        `${rawContentUrl}/cycles.json`,
        z.array(remoteNamedEntitySchema),
    );
    const encounters = await fetchJson(
        `${rawContentUrl}/encounters.json`,
        z.array(remoteNamedEntitySchema),
    );
    const packs = await fetchJson(
        `${rawContentUrl}/packs.json`,
        z.array(remoteNamedEntitySchema),
    );
    const cyclesByName = groupEntitiesByName(cycles);
    const encountersByName = groupEntitiesByName(encounters);
    const packsByName = groupEntitiesByName(packs);
    const locales = await fetchLocales();
    const imports: TranslationImport[] = [];

    for (const locale of locales) {
        const translatedCycles = await fetchJson(
            `${rawContentUrl}/translations/${encodeURIComponent(locale)}/cycles.json`,
            z.array(remoteNamedEntitySchema),
        );
        const translatedEncounters = await fetchJson(
            `${rawContentUrl}/translations/${encodeURIComponent(locale)}/encounters.json`,
            z.array(remoteNamedEntitySchema),
        );
        const translatedPacks = await fetchJson(
            `${rawContentUrl}/translations/${encodeURIComponent(locale)}/packs.json`,
            z.array(remoteNamedEntitySchema),
        );
        const campaignOutputPath = join(
            projectRoot,
            "translations",
            locale,
            "campaigns.json",
        );
        const scenarioOutputPath = join(
            projectRoot,
            "translations",
            locale,
            "scenarios.json",
        );
        const existingCampaigns = existsSync(campaignOutputPath)
            ? readArrayFile(campaignOutputPath, campaignTranslationSchema)
            : [];
        const existingScenarios = existsSync(scenarioOutputPath)
            ? readArrayFile(scenarioOutputPath, scenarioTranslationSchema)
            : [];
        const campaignTranslations = z
            .array(campaignTranslationSchema)
            .parse(
                mergeCampaignTranslations(
                    campaigns,
                    cyclesByName,
                    translatedCycles,
                    packsByName,
                    translatedPacks,
                    existingCampaigns,
                ),
            );
        const scenarioTranslations = z
            .array(scenarioTranslationSchema)
            .parse(
                mergeScenarioTranslations(
                    scenarios,
                    encountersByName,
                    translatedEncounters,
                    existingScenarios,
                    locale,
                ),
            );

        imports.push({
            campaignOutputPath,
            campaigns: campaignTranslations,
            locale,
            scenarioOutputPath,
            scenarios: scenarioTranslations,
        });
    }

    for (const translationImport of imports) {
        writeTranslations(
            translationImport.campaignOutputPath,
            translationImport.campaigns,
        );
        writeTranslations(
            translationImport.scenarioOutputPath,
            translationImport.scenarios,
        );
        console.log(
            `Imported ${translationImport.campaigns.length} campaign and ${translationImport.scenarios.length} scenario translations for ${translationImport.locale}.`,
        );
    }
}

async function fetchLocales(): Promise<string[]> {
    const entries = await fetchJson(
        `${githubApiUrl}/contents/translations?ref=${revision}`,
        translationDirectoryListSchema,
    );

    return entries
        .filter((entry) => entry.type === "dir")
        .map((entry) => translationDirectorySchema.parse(entry).name)
        .filter((name) => name !== "cs" && name !== "vn")
        .sort();
}

async function fetchJson<T>(url: string, schema: ZodType<T>): Promise<T> {
    const headers: Record<string, string> = {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    };
    const githubToken = process.env.GITHUB_TOKEN;

    if (githubToken !== undefined) {
        headers.Authorization = `Bearer ${githubToken}`;
    }

    const response = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
        throw new Error(
            `Request failed with status ${response.status}: ${response.statusText}`,
        );
    }

    const input: unknown = await response.json();
    return schema.parse(input);
}

function readArrayFile<T>(path: string, schema: ZodType<T>): T[] {
    const input: unknown = JSON.parse(readFileSync(path, "utf8"));
    return z.array(schema).parse(input);
}

function writeTranslations(
    path: string,
    translations: readonly object[],
): void {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(translations, null, 4)}\n`);
}

function mergeCampaignTranslations(
    campaigns: readonly Campaign[],
    cyclesByName: ReadonlyMap<string, readonly RemoteNamedEntity[]>,
    translatedCycles: readonly RemoteNamedEntity[],
    packsByName: ReadonlyMap<string, readonly RemoteNamedEntity[]>,
    translatedPacks: readonly RemoteNamedEntity[],
    existingTranslations: readonly CampaignTranslation[],
): CampaignTranslation[] {
    const campaignCodes = new Set(campaigns.map(({ code }) => code));
    const translatedCycleNamesByCode = uniqueNamesByCode(translatedCycles);
    const translatedPackNamesByCode = uniqueNamesByCode(
        translatedPacks.filter(({ code }) => campaignCodes.has(code)),
    );
    const existingByCode = uniqueTranslationsByCode(
        existingTranslations,
        "campaign",
    );
    assertKnownCodes(existingByCode.keys(), campaignCodes, "campaign");

    return campaigns.flatMap((campaign) => {
        const existing = existingByCode.get(campaign.code);
        const cycle = matchingCampaignEntity(campaign, cyclesByName, "cycles");
        const pack =
            cycle === undefined
                ? matchingCampaignEntity(campaign, packsByName, "packs")
                : undefined;
        const translatedName =
            cycle === undefined
                ? pack === undefined
                    ? undefined
                    : translatedPackNamesByCode.get(pack.code)
                : translatedCycleNamesByCode.get(cycle.code);

        if (translatedName === undefined && existing === undefined) {
            return [];
        }

        return [
            {
                campaign_guide_url: existing?.campaign_guide_url,
                code: campaign.code,
                name: mergeImportedName(
                    existing?.name,
                    translatedName,
                    campaign.name,
                ),
            },
        ];
    });
}

function matchingCampaignEntity(
    campaign: Campaign,
    entitiesByName: ReadonlyMap<string, readonly RemoteNamedEntity[]>,
    entityName: string,
): RemoteNamedEntity | undefined {
    const matches = entitiesByName.get(normalizeName(campaign.name)) ?? [];

    if (matches.length > 1) {
        throw new Error(
            `Campaign name matches multiple ${entityName}: ${campaign.name}`,
        );
    }

    return matches.at(0);
}

function mergeScenarioTranslations(
    scenarios: readonly Scenario[],
    encountersByName: ReadonlyMap<string, readonly RemoteNamedEntity[]>,
    translatedEncounters: readonly RemoteNamedEntity[],
    existingTranslations: readonly ScenarioTranslation[],
    locale: string,
): ScenarioTranslation[] {
    const scenarioCodes = new Set(scenarios.map(({ code }) => code));
    const translatedNamesByCode = uniqueNamesByCode(translatedEncounters);
    const existingByCode = uniqueTranslationsByCode(
        existingTranslations,
        "scenario",
    );
    assertKnownCodes(existingByCode.keys(), scenarioCodes, "scenario");

    return scenarios.map((scenario) => {
        const existing = existingByCode.get(scenario.code);
        const importedName = translatedScenarioName(
            scenario,
            encountersByName,
            translatedNamesByCode,
            locale,
        );

        return {
            campaign_guide_location: existing?.campaign_guide_location ?? null,
            code: scenario.code,
            name: mergeImportedName(
                existing?.name,
                importedName,
                scenario.name,
            ),
            rules_insert_url: existing?.rules_insert_url,
        };
    });
}

function translatedScenarioName(
    scenario: Scenario,
    encountersByName: ReadonlyMap<string, readonly RemoteNamedEntity[]>,
    translatedNamesByCode: ReadonlyMap<string, string>,
    locale: string,
): string | undefined {
    const exactEncounter = matchingScenarioEncounter(
        scenario,
        scenario.name,
        encountersByName,
        false,
    );

    if (exactEncounter !== undefined) {
        return translatedNamesByCode.get(exactEncounter.code);
    }

    const multipartName = parseMultipartName(scenario.name);
    if (multipartName === undefined) {
        return undefined;
    }

    const baseEncounter = matchingScenarioEncounter(
        scenario,
        multipartName.baseName,
        encountersByName,
        true,
    );
    if (baseEncounter === undefined) {
        return undefined;
    }

    const translatedBaseName = translatedNamesByCode.get(baseEncounter.code);
    if (
        translatedBaseName === undefined ||
        normalizeName(translatedBaseName) === normalizeName(baseEncounter.name)
    ) {
        return undefined;
    }

    return formatMultipartName(translatedBaseName, multipartName.part, locale);
}

function formatMultipartName(
    baseName: string,
    part: string,
    locale: string,
): string {
    const format = multipartFormats[locale] ?? defaultMultipartFormat;
    return `${baseName}${format.titleSuffix}${part}${format.partSuffix}`;
}

function matchingScenarioEncounter(
    scenario: Scenario,
    name: string,
    encountersByName: ReadonlyMap<string, readonly RemoteNamedEntity[]>,
    allowGlobalMatch: boolean,
): RemoteNamedEntity | undefined {
    const encounterSetCodes = new Set(
        scenario.encounter_sets.map(({ code }) => code),
    );
    const allMatches = encountersByName.get(normalizeName(name)) ?? [];
    const scenarioMatches = allMatches.filter(({ code }) =>
        encounterSetCodes.has(code),
    );
    const matches =
        scenarioMatches.length > 0 || !allowGlobalMatch
            ? scenarioMatches
            : allMatches;

    if (matches.length > 1) {
        throw new Error(
            `Scenario name matches multiple encounter sets: ${scenario.name}`,
        );
    }

    return matches.at(0);
}

function parseMultipartName(
    name: string,
): { readonly baseName: string; readonly part: string } | undefined {
    const match = /^(.*),\s*Part\s+(III|II|I)$/i.exec(name.trim());
    if (match === null) {
        return undefined;
    }

    const baseName = match.at(1);
    const part = match.at(2);
    if (baseName === undefined || part === undefined) {
        throw new Error(`Failed to parse multipart scenario name: ${name}`);
    }

    return { baseName: baseName.trim(), part: part.toUpperCase() };
}

function groupEntitiesByName(
    entities: readonly RemoteNamedEntity[],
): ReadonlyMap<string, readonly RemoteNamedEntity[]> {
    const entitiesByName = new Map<string, RemoteNamedEntity[]>();

    for (const entity of entities) {
        const normalizedName = normalizeName(entity.name);
        const matches = entitiesByName.get(normalizedName) ?? [];
        matches.push(entity);
        entitiesByName.set(normalizedName, matches);
    }

    return entitiesByName;
}

function uniqueNamesByCode(
    entities: readonly RemoteNamedEntity[],
): ReadonlyMap<string, string> {
    const namesByCode = new Map<string, string>();

    for (const { code, name } of entities) {
        if (namesByCode.has(code)) {
            throw new Error(`Duplicate remote entity code: ${code}`);
        }
        namesByCode.set(code, name);
    }

    return namesByCode;
}

function uniqueTranslationsByCode<T extends { readonly code: string }>(
    translations: readonly T[],
    entityName: string,
): ReadonlyMap<string, T> {
    const translationsByCode = new Map<string, T>();

    for (const translation of translations) {
        if (translationsByCode.has(translation.code)) {
            throw new Error(
                `Duplicate ${entityName} translation code: ${translation.code}`,
            );
        }
        translationsByCode.set(translation.code, translation);
    }

    return translationsByCode;
}

function assertKnownCodes(
    translatedCodes: Iterable<string>,
    knownCodes: ReadonlySet<string>,
    entityName: string,
): void {
    for (const code of translatedCodes) {
        if (!knownCodes.has(code)) {
            throw new Error(
                `Translation refers to unknown ${entityName} code: ${code}`,
            );
        }
    }
}

function mergeImportedName(
    existingName: string | undefined,
    importedName: string | undefined,
    englishName: string,
): string | undefined {
    if (existingName === undefined) {
        return importedName;
    }

    if (normalizeName(existingName) !== normalizeName(englishName)) {
        return existingName;
    }

    return importedName ?? existingName;
}

function normalizeName(name: string): string {
    return name
        .normalize("NFKC")
        .trim()
        .replace(/\s+/g, " ")
        .toLocaleLowerCase("en-US");
}
