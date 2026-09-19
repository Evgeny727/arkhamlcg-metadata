import { z } from "zod";

export const campaignTranslationSchema = z
    .strictObject({
        campaign_guide_url: z
            .url()
            .optional()
            .describe("URL of the translated campaign guide."),
        code: z.string().describe("Code of the campaign being translated."),
        name: z
            .string()
            .optional()
            .describe("Translated display name of the campaign."),
    })
    .refine(
        ({ campaign_guide_url, name }) =>
            campaign_guide_url !== undefined || name !== undefined,
        { message: "A campaign translation must define a translated field." },
    );

export type CampaignTranslation = z.infer<typeof campaignTranslationSchema>;
