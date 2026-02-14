export const TEST = {
  BASE_URL: process.env.BASE_URL || 'http://localhost:3000',
  ADMIN_EMAIL: process.env.ADMIN_EMAIL || '',
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || '',
  PDF_PATH: process.env.PDF_PATH || '',
  QA_LLM_ENABLED: process.env.QA_LLM_ENABLED === 'true',
  VECTORS_ENABLED: process.env.VECTORS_ENABLED === 'true',
  STAGE_WARN_MS: {
    upload: Number(process.env.STAGE_WARN_MS_upload || 10000),
    ocr: Number(process.env.STAGE_WARN_MS_ocr || 60000),
    parse: Number(process.env.STAGE_WARN_MS_parse || 20000),
    qa: Number(process.env.STAGE_WARN_MS_qa || 15000),
    persist: Number(process.env.STAGE_WARN_MS_persist || 15000),
    vectors: Number(process.env.STAGE_WARN_MS_vectors || 20000)
  }
};
export type StageName = keyof typeof TEST.STAGE_WARN_MS;