# Branding contract

No user-visible interface should include the historical product name as a literal. All brand-specific UI labels, app title, PWA manifest, push notifications, public cards, legal pages and receipts use the environment/config interface.

Required keys: `APP_NAME`, `APP_SHORT_NAME`, `APP_SLUG`, `APP_MARK`, `APP_PUBLIC_URL`, `APP_SUPPORT_URL`, `APP_LEGAL_NAME`, `APP_COPYRIGHT_NAME`, `APP_THEME_COLOR`, `APP_PWA_ICONS`.

Technical identifiers (GitHub repository, source URLs, commit SHAs) are not user-facing branding. The final name may change without code rewrites, migration renames or key re-derivation. See `ts.md §0.4` and `apps/api/config/brand.php`.
