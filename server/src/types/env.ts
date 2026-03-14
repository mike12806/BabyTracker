export interface Env {
  DB: D1Database;
  PHOTOS: R2Bucket;
  CF_ACCESS_TEAM_DOMAIN: string;
  CF_ACCESS_AUD: string;
  DEV_MODE?: string;
}
