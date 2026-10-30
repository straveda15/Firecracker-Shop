# Firecracker Shop - Billing & Inventory

Setup: copy `.env.example` to `.env`, fill in MONGODB_URI, ADMIN_PASSWORD, STAFF_PASSWORD, then `npm install`.
Run: double-click `start.bat` (or `npm start`; Node 20.12+).
Open http://localhost:3000. The console also prints a LAN address to use from a phone on the same Wi-Fi.

Logins: `admin` and `staff`, with the passwords from ADMIN_PASSWORD / STAFF_PASSWORD (seeded on first run; change later in Settings).
Data is stored in MongoDB (database `firecracker`).

Printing: Print uses the browser print dialog at 80mm/58mm (set in Settings); choose the thermal printer
(or "Save as PDF"). "Download PDF" needs internet once to load the PDF libraries.
For internet/HTTPS access, put the app behind an HTTPS reverse proxy.
