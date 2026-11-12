# DocuVault 2.0 — office server edition

One office computer holds the shared documents and accounts. Everyone signs in from their own laptop or phone.

- **During working hours** the office computer shares everyone's changes within seconds.
- **When it's off**, people keep working on their devices; changes sync when it's back on.
- **Document numbers** (e.g. `DCT-2026-0003`) are given by the office computer, so two devices never make the same number. Documents filed offline show "Code pending" until then.

## What you need

- The office computer: Windows 10 or 11, on during working hours. Nothing else has to be installed by hand.
- A domain you control, e.g. `delacruztrading.ph` (you'll use a sub-address like `docs.delacruztrading.ph`).
- A free Cloudflare account (for the secure address).
- Optional but strongly recommended: Google Drive for desktop on the office computer, for off-site backups.

## Setup (about 30 minutes, once)

### 1. Get the secure address ready (Cloudflare)
1. Sign up at **cloudflare.com** and add your domain (Cloudflare shows how to change the domain's nameservers at your registrar; this can take a few hours to finish).
2. In Cloudflare go to **Zero Trust › Networks › Tunnels › Create a tunnel › Cloudflared**. Name it "DocuVault".
3. Under **Install connector**, choose Windows and copy the **token** (the long text after `service install`). Keep it for step 2.
4. Under **Public hostname**: subdomain `docs`, your domain, Service **HTTP** `localhost:8080`. Save.

### 2. Install on the office computer
1. Copy the whole **DocuVault** folder to the office computer, e.g. `C:\DocuVault`. Keep it there.
2. Right-click **Install DocuVault Server (Windows).bat** › **Run as administrator**. It:
   - installs Node.js if needed,
   - makes DocuVault start automatically whenever someone signs in to that computer,
   - asks for a backup folder — give a folder inside Google Drive, e.g. `G:\My Drive\DocuVault Backups`,
   - asks for the Cloudflare token from step 1 and installs the tunnel,
   - starts the server. A black window shows the **setup code**.

### 3. First sign-in
1. On any device open **https://docs.yourdomain** (your address from step 1).
2. Enter the **setup code** from the server window, create the super admin and the first business.
3. **Users & access › Add user** for each staff member. Give each person their temporary password; they choose their own on first sign-in.
4. On each laptop/phone: open the address › **Install** (Chrome/Edge) or **Share › Add to Home Screen** (iPhone).

## Day to day

- Turn on the office computer in the morning and sign in to Windows; DocuVault starts by itself (minimized black window — don't close it).
- The sidebar shows **Synced 9:42 AM**, or **Office server not reachable — working offline · 3 waiting**. Click it to sync now.
- Before shutting down the office computer, close the DocuVault window; it makes a final backup.

## Backups

- The server saves a copy every 2 hours while running, and when it's closed. It keeps the last 30.
- If the backup folder is inside Google Drive for desktop, every copy also goes to Google Drive automatically.
- **Backup & sync › Back up now** makes one immediately.
- To restore: close the server window, copy the newest `docuvault-….db` from the backup folder to `DocuVault\data\docuvault.db`, copy the backup's `files` folder into `DocuVault\data\files`, then start the server again.

## Security notes

- Passwords are scrambled before storage; after 5 wrong tries an account waits 5 minutes.
- The server only accepts connections from the same computer. Everyone else comes in through the encrypted Cloudflare tunnel, so nothing on your router needs opening.
- Each person only receives the businesses they're allowed to see. The server checks every change, so a device can't save what its user isn't allowed to.
- Turning off a user signs them out on all their devices at their next sync.
- Each device's offline copy isn't encrypted; use phone and computer screen locks.
- Keep the office computer's Windows updates on.

## Without a domain (testing only)

Double-click **Start DocuVault Server (Windows).bat** and open **http://localhost:8080** on that same computer. Other devices need the Cloudflare address.

## Folder contents

| | |
|---|---|
| `Install DocuVault Server (Windows).bat` | One-time setup on the office computer |
| `Start DocuVault Server (Windows).bat` | Starts the server (runs automatically after install) |
| `Start DocuVault Server (Mac or Linux).command` | Same for a Mac or Linux office computer |
| `server/` | The server program |
| `app/` | The app people use on their devices |
| `data/` | Created on first start: database, files, settings. **Back this up.** |
| `tools/` | Helper to change the backup folder |

## Workflows, receiving and notifications (new in 2.1)

**Set up a workflow once** (business admins): **Workflows › Workflow setup › New workflow**.
- Give it a name and the document type it's for (e.g. "Cash advance request"); it then starts automatically for that type.
- Add steps: what happens (review, approve or return, sign, file, task), who does it (a person, or anyone with a role such as "Any Business admin"), a target time, and a checklist that must be ticked before the step can finish.

**Receive a document**: **Receive document** in the sidebar.
- Fill in the details, attach the main file (or take a photo) and any supporting files.
- The matching workflow is picked automatically, with its steps and checklist shown.
- **Receive and start** gives it a code, starts the workflow and tells the first person. Print the **QR label** and the **routing slip** (steps, checklist, sign-off boxes and QR code) for the paper copy.

**Working a step**: **Workflows › Waiting for me**, or tap the notification.
- Tick the checklist, add a note if needed, then finish to send it on. **Return** sends it back one step and needs a note.
- Steps past their target time are flagged red. Admins can complete a step for someone who is away, or cancel a workflow.
- Every action is kept in the workflow's history.

**Notifications**: assignments, returns and finished workflows appear under **Notifications** with a count in the sidebar. **Turn on pop-up alerts** to get them on the device's screen while DocuVault is open.

## New in 2.2

**Workflow management** follows the Docutrakr layout:
- Five summary cards: active workflows, completed today, average turnaround (with trend), overdue workflows and templates.
- On the left, tabs for Active, Mine, Finished and Templates, with search, status filter and pages.
- On the right, the selected document's details: code, received by, date received, current status, expected turnaround, elapsed time and a link to the document.
- Five tabs: **Workflow diagram** (step cards with person, date and status, plus time spent and SLA under each), **Process details** (every step with department and remarks), **Comments**, **Attachments** (add supporting files here) and **History**.
- Below the diagram: process details for the selected step (click any step), with the action buttons when it's your turn, and a turnaround summary (expected, so far, remaining, on track / at risk / overdue).
- **Export** downloads all workflows as a spreadsheet file (CSV). **Download diagram** saves the steps as a picture (SVG).
- Steps now have a **department / section**.

**Folder map**: Documents › **Map** shows the business, its folders and each folder's newest documents as a mind map. Colors show which documents are in a workflow, overdue or finished. Click any box to open it, or **Download map**.

## Version 3.0: two ways to run the server

The app is the same either way. Pick where its server lives:

**A. Office computer** (as before): the office PC runs `server/server.mjs` and serves the app. Files are kept on that PC. Nothing below is needed.

**B. Cloud (Floot + Google Drive):** no PC needs to stay on, and staff sync from anywhere.
- The server is the Floot project **DocuVault Server**. It keeps only small records (users, document details, workflows, notifications, activity). Every file goes to the owner's Google Drive, in a folder called **DocuVault Files**; Floot passes files through in 4 MB pieces and keeps none.
- Setup:
  1. Publish **DocuVault Server** in Floot.
  2. Open its published address, sign in with your Floot email ("Forgot password?" the first time), and click **Connect Google Drive**. The page also shows the **server address** and a one-time **setup code**.
  3. Put the server address in `app/config.js` (the `DOCUVAULT_SERVER` line).
  4. Host the `app` folder on a web host (for example Netlify: drag the folder onto app.netlify.com/drop). `app/_headers` already holds its security rules.
  5. Open the hosted app, enter the setup code, and create the super admin and first business.
- Overdue reminders and escalation run on Floot by themselves, timed to each deadline.
- Coming with the DocuVault PC program: an exact copy of every file and record on the office PC, dated backups to Google Drive, and restore.

Both servers use the same short requests (`/_api/...`) and send files in 4 MB pieces, so the app works with either and you can switch later.

## New in 2.3

- **Paper originals** (sidebar): lend out the physical original from any document page (who, purpose, due date), mark it returned, and see everything borrowed and overdue in one list. **Scan QR label** opens a document from its label (Chrome on Android/Mac; elsewhere the phone camera app opens the label link).
- **Track my document**: every new document gets a private 6-digit PIN. Print the **requester receipt** (code, PIN, QR) from the received page or document page. The requester scans it or opens `…/#/track` and sees each step and where it is now — without signing in, and without seeing the document's title or contents. Wrong PINs are refused and repeated guessing is blocked.
- **Automatic escalation**: when a step passes its target time, the people responsible get a reminder. If it stays stuck (half the target again, at least 4 hours), the step's chosen supervisor — or the business admins — are alerted. Runs on the office server every 10 minutes.
- **Out of office**: **My account** (click your name) › Out of office. Choose until when and who covers; steps assigned to you also go to your backup. Admins can set it for others under Users & access.
- **Departments**: add them under Businesses & folders › Edit (one per line), tick them for each user, and send workflow steps to "Anyone in Finance".
- **Reports** (managers and admins): workflows started and completed, average turnaround, on-time rate, overdue now, monthly volume, slowest steps, and figures by workflow, person and department, for 30 / 90 / 365 days. **Export** opens in Excel.
- **Batch scan** (Inbox › Batch scan): add a stack of page images or photos, mark where each document starts, and press **Make documents** — each becomes one PDF in the Inbox. Print a **separator sheet** to put between documents; it's detected automatically in Chrome on Android/Mac and left out.
- **Duplicate check**: a file that's already stored is flagged in the Inbox with a link to the existing copy, and Receive asks before storing it again.
- **Retention** (admins): set how many years each folder's documents are kept (from the date received or the expiry date). See what's due for disposal or coming up, put documents **on hold** with a reason, and dispose (moves to the recycle bin with the reason recorded).

## Not included yet

- **Text search inside scans** needs an offline text-recognition library that's too large to add here; it can come later.
- Escalation reminders only go out while the office server is running.

## Coming next

Standalone checklists with @ assignments, templates and forms, e-signature, and renewals.
