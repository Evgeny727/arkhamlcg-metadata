All material in this repository comes directly from the published FAQs and Grimoire for Fantasy Flight Games' _Arkham Horror: The Card Game_, or is derivative of content from that game. All textual content here is copyrighted by Fantasy Flight Games. This repository is not produced by, supported by, or affiliated with Fantasy Flight Games.

# Formatting

```sh
# once
npm install

# format all files
npm run fmt
```

_Requires Node.js._

# Translations

Translation files are kept in `./translations`. Right now, only campaigns and scenarios are translatable.

```text
translations/
    de/
        campaigns.json
        scenarios.json
```

Each file contains translated field overrides keyed by the entity `code`. The
English source data remains in `campaigns/campaigns.json` and
`scenarios/scenarios.json`.

Run the translation import to infer campaign and scenario names from `Kamalisk/arkhamdb-json-data`:

```sh
npm run import:translations
```

New scenario translations use `null` when the translated campaign guide page
is absent. The import only fills missing fields and preserves adjusted translated
names, page numbers, guide URLs, and rules insert URLs.
