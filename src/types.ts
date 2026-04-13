export type Bindings = {
  DB: D1Database;
  PHOTOS: R2Bucket;
  ADMIN_USERS: string; // "email:password,email2:password2"
  JWT_SECRET: string;
  FRONTEND_URL: string;
  DEFAULT_ALBUM_SLUG: string;
};
