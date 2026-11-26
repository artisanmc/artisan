- **Fixed**: an image or a menu redrawn over a module's original, then deployed, and whose
  module shipped a new original at the next restart, was not marked **The original changed
  since your version**: the server recorded the new original as the one your version was made
  against. The origin is now recorded when your version is deployed.
