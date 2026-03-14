-- Track whether a child has a photo (actual image stored in R2)
ALTER TABLE children ADD COLUMN picture_content_type TEXT;
