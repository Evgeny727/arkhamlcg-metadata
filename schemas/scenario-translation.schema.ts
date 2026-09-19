import { z } from "zod";

export const scenarioTranslationSchema = z
    .strictObject({
        campaign_guide_location: z
            .number()
            .int()
            .positive()
            .optional()
            .describe(
                "One-based PDF page where the translated scenario section begins.",
            ),
        code: z.string().describe("Code of the scenario being translated."),
        name: z
            .string()
            .optional()
            .describe("Translated display name of the scenario."),
        rules_insert_url: z
            .url()
            .optional()
            .describe("URL of the translated scenario rules insert."),
    })
    .refine(
        ({ campaign_guide_location, name, rules_insert_url }) =>
            campaign_guide_location !== undefined ||
            name !== undefined ||
            rules_insert_url !== undefined,
        { message: "A scenario translation must define a translated field." },
    );

export type ScenarioTranslation = z.infer<typeof scenarioTranslationSchema>;
