// @ts-check
import { defineConfig } from 'astro/config';

export default defineConfig({
  /**
   * `site` is REQUIRED, not optional decoration.
   *
   * The layout derives every canonical from it, and the sitemap endpoint builds absolute
   * <loc> values from it. Leave it unset and canonicals silently become relative to
   * whatever host served the build — which is how a staging deploy ends up telling Google
   * that staging is canonical.
   */
  site: 'https://example.com',

  /**
   * Trailing slash is enforced rather than left to the host, because "/about" and
   * "/about/" are two URLs to a crawler. Pick one and make everything agree: the layout's
   * canonical, the sitemap, and check:discovery all read the same routes.
   */
  trailingSlash: 'always',

  build: {
    format: 'directory',
  },
});
