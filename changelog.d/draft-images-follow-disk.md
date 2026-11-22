- **Fixed**: A draft opened before a module updated its images (new or redrawn `originals/assets`)
  kept the old image list: the editor drew the old images and a button whose new image was missing
  showed its asset's name in green. Reopening the project now brings the images the draft did not
  change up to the server's, as it already did for the text files.
