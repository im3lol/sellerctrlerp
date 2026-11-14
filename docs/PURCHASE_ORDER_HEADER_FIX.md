# Purchase order table header — 2026-10-24

PurchaseOrderForm had only 4 header cells for 12 body cells; eight column titles were absent, placing Total over the image column. Restored Image, Item, Unit, Quantity, Price, Shipping/unit, Discount and Tax in exactly the body-cell order. Shared table CSS and document calculations are unchanged. Existing translation keys reused.

Validated the original mismatch in a real authenticated browser. After deployment, Arabic and English both have 12 matching header/body cells, matching horizontal geometry while scrolled and at mobile width. Additional OTHER charge tested in local form state: 13 matching cells; no form saved or document submitted. Screenshots and browser test evidence under locally ignored .ops-data/po-header-20261024/. Targeted ESLint, full build and TypeScript passed. App and worker healthy, public health OK.

Deployed build: PPpv5ue0bfkC82ydludRh. Rollback images: sellerctrl-app:before-po-header-20261024 / sellerctrl-worker:before-po-header-20261024. No migration or business-data update.
