# CCMC RetailFlow — Owner Modules

## Run locally
1. Keep your original `.env` file in the project root (not included in this archive for security).
2. Install `pip install -r backend/requirements.txt`.
3. Ensure your existing TiDB Cloud database has been created from `database/schema.sql` and your TLS CA path is configured.
4. Run `python backend/app.py`.
5. Log in with an existing Owner account at `http://127.0.0.1:5000/frontend/index.html`.
6. Open the Owner Dashboard; all sidebar modules now have working navigation.

## Included backend
- Owner dashboard summary and recent transactions
- Owner listing APIs for all modules
- Create/update products and suppliers; update user role/status
- Stock adjustments with inventory transaction logs
- POS checkout with stock locking, stock deduction and transaction log
- Reservation creation with order items
- Returns with quantity validation and optional restock
- Financial summary and daily sales reports

## Important limitations
- This is a development integration, not a production-ready retail system.
- Live database connection is required. No dummy rows are substituted for unavailable data.
- Sales quick-entry interface handles one product per checkout; API supports multiple items.
- User account creation/password reset, reservation-to-sale conversion, reservation cancellation/refunds, scheduled expiry, end-of-day voiding, payment verification, official Senior/PWD discount computation, report export and full refund disbursement workflows are not implemented.
- Cash/GCash are **recorded** as payment methods; no GCash gateway or payment confirmation is integrated.
- Returns are recorded, but this does not issue money to the customer.
- The financial view is an estimated item margin, not a full profit-and-loss statement.
- Existing login and session-based role restrictions are retained. Review CSRF protection, session cookie secure flag, deployment security, audit logs, and tests before production use.
- All UI styling shares `frontend/dashboard/dashboard.css`, `frontend/css/buttons.css`, and `frontend/css/owner-modules.css`.
