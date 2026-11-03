# Firecracker Shop - Billing & Inventory

Setup: copy `.env.example` to `.env`, fill in MONGODB_URI, ADMIN_PASSWORD, STAFF_PASSWORD, then `npm install`.
Run: double-click `start.bat` (or `npm start`; Node 20.12+).
Open http://localhost:3000. The console also prints a LAN address to use from a phone on the same Wi-Fi.

Logins: `admin` and `staff`, with the passwords from ADMIN_PASSWORD / STAFF_PASSWORD (seeded on first run; change later in Settings).
Data is stored in MongoDB (database `firecracker`).

Printing: Print uses the browser print dialog at 80mm/58mm (set in Settings); choose the thermal printer
(or "Save as PDF"). "Download PDF" needs internet once to load the PDF libraries.
For internet/HTTPS access, put the app behind an HTTPS reverse proxy.

One-tap thermal printing (Epson TM-m30III, Server Direct Print): set SPD_KEY (a long random secret) in the
environment. In the printer's Web Config (type its IP in a browser) > Server Direct Print, enable it and set the
URL to `https://<your-site>/api/spd?key=<SPD_KEY>` with a 1-5 second interval; if the printer cannot verify the
site's HTTPS certificate, import the CA root certificate under Network Security. Print then sends the receipt
(any language, drawn as an image) to the printer without a dialog. Without SPD_KEY the Print button opens the
normal browser print dialog.
