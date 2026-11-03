# Firecracker Shop - Billing & Inventory

Setup: copy `.env.example` to `.env`, fill in MONGODB_URI, ADMIN_PASSWORD, STAFF_PASSWORD, then `npm install`.
Run: double-click `start.bat` (or `npm start`; Node 20.12+).
Open http://localhost:3000. The console also prints a LAN address to use from a phone on the same Wi-Fi.

Logins: `admin` and `staff`, with the passwords from ADMIN_PASSWORD / STAFF_PASSWORD (seeded on first run; change later in Settings).
Data is stored in MongoDB (database `firecracker`).

Printing: Print uses the browser print dialog at 80mm/58mm (set in Settings); choose the thermal printer
(or "Save as PDF"). "Download PDF" needs internet once to load the PDF libraries.
For internet/HTTPS access, put the app behind an HTTPS reverse proxy.

One-tap thermal printing (Epson TM-m30III, Server Direct Print): the Print button draws the receipt as an image (so
any language works) and queues it in MongoDB. The PRINTER ITSELF polls the site every few seconds, prints the job and
confirms it; the app shows "Print successful" only after that confirmation. No laptop, driver or app is needed, and it
works from any phone or computer that opens the site. Without PRINTER_KEY, or in A4 mode, Print opens the browser dialog.

Server setup: set PRINTER_KEY (a long random secret, 32+ characters) in the environment and redeploy.
Printer setup (printer web page > TM-i Settings > Services > Server Direct Print):
  Server Direct Print = Enable, Server1 URL = https://<your-site>/api/printer/poll?key=<PRINTER_KEY>,
  Interval = 5, leave ID / Password empty, Server Authentication = Disable, then Apply & Restart.
Printer panel: the "Printer" button in the top bar shows connection state, last seen, a Test print button and the
print history with Retry for failed jobs.

API (all except the poll endpoint need the normal login):
  POST /api/print {data(base64 ESC/POS), invoiceId}  queue a receipt (one live job per invoice; 503 if printer offline)
  GET  /api/print/:id                                job status: queued | processing | printed | failed
  POST /api/print/:id/retry                          re-queue a failed job
  POST /api/printer/test                             queue a test slip
  GET  /api/printer/status                           online?, last seen, serial, last 15 jobs
  GET  /api/printer/log                              raw non-poll requests from the printer (troubleshooting)
  POST /api/printer/poll?key=...                     called by the printer only (secret key in the URL)
