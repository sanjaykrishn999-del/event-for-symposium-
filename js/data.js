/* PhishGuard — scenario data. All content is fictional and educational. */
/* =========================================================================
   PHISHGUARD — data
   Every scenario below is fictional. Brands, domains, names, amounts and
   reference numbers are invented for training purposes.
   ========================================================================= */

const QUESTIONS = [

/* ---------------------- EMAIL ---------------------- */
{
  id:"e1", category:"email", difficulty:"easy", type:"email",
  title:"Bank security alert",
  sender:{name:"Aurora Bank Security", email:"alerts@aurorabank-verify-now.tk", initials:"AB", color:"#1b3a6b"},
  subject:"Urgent: Your account requires verification",
  date:"Today, 03:14",
  body:`<div class="brandlogo"><span class="sq" style="background:#e8b23a">A</span> AURORA BANK</div>
    <p>Dear Vaued Customer,</p>
    <p>Your account has been temporarily restricted due to unusual activity detected from a new device. Please verify your account <b>within 24 hours</b> to prevent permanent suspension.</p>
    <p><button class="fakebtn" disabled>VERIFY ACCOUNT</button></p>
    <p style="font-size:.85rem">Or paste this link into your browser:<br><span class="fakelink">http://aurorabank-verify-now.tk/secure/login.php?id=8841</span></p>
    <p class="sig">Aurora Bank Security Team. Do not reply to this message.</p>`,
},
{
  id:"e2", category:"email", difficulty:"easy", type:"email",
  title:"Campus exam timetable",
  sender:{name:"Examination Cell", email:"exam.cell@vidyanagar-institute.edu", initials:"VI", color:"#2b4d3a"},
  subject:"Semester 5 timetable published on the student portal",
  date:"Mon, 10:42",
  body:`<p>Dear students,</p>
    <p>The Semester 5 examination timetable has been published. You can view it by logging into the student portal directly, or from the notice board outside the Examination Cell (Block C, ground floor).</p>
    <p>No action is required from this email. If any subject appears incorrectly on your hall ticket, raise a query at the Examination Cell counter between 10:00 and 16:00 with your ID card.</p>
    <p class="sig">Examination Cell · Vidyanagar Institute of Technology · Internal circular EC/2026/114</p>`,
},
{
  id:"e3", category:"email", difficulty:"medium", type:"email",
  title:"Password reset you requested",
  sender:{name:"Nimbus Drive", email:"no-reply@accounts.nimbusdrive.com", initials:"ND", color:"#25406b"},
  subject:"Password reset requested for your Nimbus Drive account",
  date:"Today, 18:05",
  body:`<div class="brandlogo"><span class="sq" style="background:#4f9cf9">N</span> Nimbus Drive</div>
    <p>We received a request to reset the password for the account ending <b>@vidyanagar-institute.edu</b>.</p>
    <p>This reset link stays valid for 30 minutes and can be used once.</p>
    <p><button class="fakebtn" disabled>Reset password</button></p>
    <p><b>Didn't request this?</b> You can safely ignore this email — your password will not change, and no further action is needed. If you'd like to review recent sign-ins, open Nimbus Drive and go to Security in your account settings.</p>
    <p class="sig">Sent from a monitored address at accounts.nimbusdrive.com · Request ID 4c19-77ad</p>`,
},
{
  id:"e4", category:"email", difficulty:"medium", type:"email",
  title:"Cloud storage almost full",
  sender:{name:"Nimbus Drive Billing", email:"billing@nimbusdrive-alerts.co", initials:"NB", color:"#3a2b5c"},
  subject:"Action needed: your files will be deleted in 48 hours",
  date:"Today, 09:20",
  body:`<div class="brandlogo"><span class="sq" style="background:#4f9cf9">N</span> Nimbus Drive</div>
    <p>Hello,</p>
    <p>Your storage is <b>99.8% full</b>. Accounts that exceed their quota for more than 48 hours are scheduled for <b>permanent file deletion</b>, including shared folders and backups.</p>
    <p>Upgrade now to keep your files. Payment takes less than a minute.</p>
    <p><button class="fakebtn green" disabled>Upgrade for ₹49</button></p>
    <p style="font-size:.85rem"><span class="fakelink">https://nimbusdrive-alerts.co/billing/upgrade?u=stu4471</span></p>
    <p class="sig">Nimbus Drive Billing</p>`,
},
{
  id:"e5", category:"email", difficulty:"easy", type:"email",
  title:"Delivery redelivery fee",
  sender:{name:"SwiftPost Delivery", email:"support@swiftpost-redelivery.info", initials:"SP", color:"#5c3a1b"},
  subject:"Your parcel could not be delivered — pay ₹35 to reschedule",
  date:"Today, 07:58",
  body:`<p>Dear customer,</p>
    <p>Our courier attempted delivery of parcel <b>SP-772841</b> but the address was incomplete. To reschedule, a small redelivery charge of <b>₹35</b> must be paid within 12 hours or the parcel will be returned to sender.</p>
    <p><button class="fakebtn" disabled>Pay ₹35 and reschedule</button></p>
    <p style="font-size:.85rem"><span class="fakelink">http://swiftpost-redelivery.info/pay/SP772841</span></p>
    <p class="sig">SwiftPost Customer Care</p>`,
},
{
  id:"e6", category:"email", difficulty:"hard", type:"email",
  title:"Job offer with onboarding fee",
  sender:{name:"Meridian Analytics — Talent", email:"careers@rneridian-analytics.com", initials:"MA", color:"#1b3d4d"},
  subject:"Offer of employment — Junior Data Analyst (remote)",
  date:"Thu, 16:31",
  body:`<div class="brandlogo"><span class="sq" style="background:#2f9fb0">M</span> Meridian Analytics</div>
    <p>Dear Candidate,</p>
    <p>Following the review of your profile on our careers portal, we are pleased to extend an offer for the position of <b>Junior Data Analyst (Remote)</b>, with a monthly compensation of ₹62,000 and a start date of the 1st.</p>
    <p>To confirm your position, kindly complete onboarding within 3 working days:</p>
    <ol><li>Sign the attached offer letter.</li><li>Submit a scanned copy of your Aadhaar and PAN, plus a cancelled cheque.</li><li>Pay the refundable equipment deposit of ₹4,500 to the account in the attachment (refunded with your first salary).</li></ol>
    <p><span class="attach">📎 Offer_Letter_Meridian_JDA.pdf.exe · 812 KB</span></p>
    <p class="sig">Talent Acquisition · Meridian Analytics<br>This position was not advertised publicly.</p>`,
},
{
  id:"e7", category:"email", difficulty:"medium", type:"email",
  title:"Social media verification badge",
  sender:{name:"Pulse Verification Team", email:"verify@pulse-badge-review.com", initials:"PV", color:"#4a1b52"},
  subject:"Your verification badge application is pending approval",
  date:"Today, 21:47",
  body:`<div class="brandlogo"><span class="sq" style="background:#c44ad6">P</span> Pulse</div>
    <p>Hi @creator,</p>
    <p>Your profile qualifies for a <b>verified badge</b>. Our review team needs to confirm ownership of the account before the badge is applied.</p>
    <p>Sign in below to confirm. You will be asked for your password and the 6-digit code sent to your phone.</p>
    <p><button class="fakebtn" disabled>Confirm account ownership</button></p>
    <p style="font-size:.85rem">Applications not confirmed within 24 hours are withdrawn and cannot be resubmitted for 6 months.</p>
    <p class="sig">Pulse Verification · Automated message</p>`,
},
{
  id:"e8", category:"email", difficulty:"hard", type:"email",
  title:"Shopping refund confirmation",
  sender:{name:"Kettle & Co Orders", email:"orders@kettleandco.in", initials:"KC", color:"#4d3a1b"},
  subject:"Refund processed for order KC-40218",
  date:"Tue, 12:09",
  body:`<div class="brandlogo"><span class="sq" style="background:#d98a3a">K</span> Kettle &amp; Co</div>
    <p>Hi Ananya,</p>
    <p>We've processed the refund for the returned item in order <b>KC-40218</b> (1 × ceramic pour-over, ₹1,240).</p>
    <p>The amount was returned to the original payment method and usually appears within 5–7 working days, depending on your bank. Your order history in the app shows the current status.</p>
    <p>Nothing further is needed from you. If the amount hasn't arrived after 7 working days, reply to this email or use Help in the app and quote the order number.</p>
    <p class="sig">Kettle &amp; Co · Order updates are also visible under Orders in the app.</p>`,
},
{
  id:"e9", category:"email", difficulty:"easy", type:"email",
  title:"Library newsletter",
  sender:{name:"Central Library", email:"library@vidyanagar-institute.edu", initials:"CL", color:"#2b3a52"},
  subject:"New arrivals and extended hours during exam week",
  date:"Fri, 15:02",
  body:`<p>Hello all,</p>
    <p>The library will stay open until 23:00 from the 18th to the 29th. Forty new titles in networking and cryptography are now on the second-floor shelves.</p>
    <p>Reading-room seats can be reserved at the front desk on the day. No online booking, no fees.</p>
    <p class="sig">Central Library · Reply to this address for queries · Unsubscribe from library mail at the front desk</p>`,
},

/* ---------------------- SMS ---------------------- */
{
  id:"s1", category:"sms", difficulty:"easy", type:"sms",
  title:"Bank account blocked",
  from:"+91 98xxx 41207",
  messages:[{text:"AURORA BANK: Your a/c has been BLOCKED due to incomplete KYC. Update now to avoid permanent closure: <span class='link'>http://bit.ly/aurora-kyc-upd</span> - Team Aurora"}],
  stamp:"Received 02:41",
},
{
  id:"s2", category:"sms", difficulty:"easy", type:"sms",
  title:"Parcel address problem",
  from:"+91 70xxx 88310",
  messages:[{text:"Your SwiftPost parcel is on hold - address incomplete. Confirm details here to reschedule today: <span class='link'>swftpost-track.co/in</span>"}],
  stamp:"Received 11:06",
},
{
  id:"s3", category:"sms", difficulty:"medium", type:"sms",
  title:"Lottery reward",
  from:"VM-WINPRZ",
  messages:[{text:"Congratulations! Your mobile number was selected in the Annual Consumer Draw. Claim your prize of Rs 25,00,000 within 48hrs. Processing fee Rs 2,500 applies. Reply YES for agent call."}],
  stamp:"Received 19:22",
},
{
  id:"s4", category:"sms", difficulty:"medium", type:"sms",
  title:"Transaction OTP",
  from:"AURBNK",
  messages:[{text:"482913 is your OTP for a debit of Rs 1,499.00 to KETTLE AND CO at 12:04. Valid 5 min. Aurora Bank NEVER asks for this OTP. If this wasn't you, call 1800-xxx-xxxx."}],
  stamp:"Received 12:04",
},
{
  id:"s5", category:"sms", difficulty:"hard", type:"sms",
  title:"Part-time work offer",
  from:"+44 7xxx xxx902",
  messages:[
    {text:"Hi! I'm Riya from Meridian Digital HR. We saw your profile and have a part-time task-based role - Rs 2,000-5,000 per day, 1 hour work from home. Interested?"},
    {text:"Great! Just complete 3 sample tasks to activate your account. Small refundable deposit of Rs 1,000 unlocks the higher-paying task set. Payout is instant after each batch."}
  ],
  stamp:"WhatsApp · Riya (HR) · unsaved number",
},
{
  id:"s6", category:"sms", difficulty:"medium", type:"sms",
  title:"Account suspension warning",
  from:"+91 63xxx 20554",
  messages:[{text:"[PULSE] Unusual login from Jakarta detected. Your account will be suspended in 2 hours. Secure it now: <span class='link'>pulse-secure-login.net/verify</span> Ignore if this was you."}],
  stamp:"Received 23:51",
},

/* ---------------------- FAKE WEBSITES ---------------------- */
{
  id:"w1", category:"website", difficulty:"easy", type:"website",
  title:"Bank login page",
  url:"http://secure-aurorabank-login.verify-account.co/netbanking",
  secure:false,
  site:{brand:"AURORA BANK", color:"#e8b23a", heading:"Sign in to Net Banking",
    note:"Session expires in 04:58 — complete verification now",
    popup:"⚠ Your browsing is not secure. Verify your identity to continue.",
    fields:["Customer ID","Password","Confirm your ATM PIN"]},
},
{
  id:"w2", category:"website", difficulty:"medium", type:"website",
  title:"Social login page",
  url:"https://puIse-social.com/login",
  secure:true,
  site:{brand:"PuIse", color:"#c44ad6", heading:"Log in to Pulse",
    note:"Continue with email",
    popup:"", fields:["Email or phone","Password"]},
},
{
  id:"w3", category:"website", difficulty:"medium", type:"website",
  title:"Shop checkout page",
  url:"https://www.kettleandco.in/checkout/payment",
  secure:true,
  site:{brand:"Kettle & Co", color:"#d98a3a", heading:"Payment",
    note:"Order KC-40218 · ₹1,240 · Ships to Nashik 422001",
    popup:"", fields:["Card number","Expiry / CVV"]},
},
{
  id:"w4", category:"website", difficulty:"hard", type:"website",
  title:"Cloud storage sign-in",
  url:"https://nimbusdrive.com.account-verify.net/signin?ref=shared-doc",
  secure:true,
  site:{brand:"Nimbus Drive", color:"#4f9cf9", heading:"Sign in to view the shared document",
    note:"A document was shared with you · sign in to continue",
    popup:"", fields:["Work email","Password"]},
},
{
  id:"w5", category:"website", difficulty:"hard", type:"website",
  title:"Net banking portal",
  url:"https://netbanking.aurorabank.in/login",
  secure:true,
  site:{brand:"AURORA BANK", color:"#e8b23a", heading:"Net Banking",
    note:"Last login: 14 Sep, 19:12 · Registered device",
    popup:"", fields:["Customer ID","Password"]},
},

/* ---------------------- QR / QUISHING ---------------------- */
{
  id:"q1", category:"qr", difficulty:"easy", type:"qr",
  title:"Parking meter sticker",
  poster:{heading:"PAY FOR PARKING HERE",sub:"Scan to pay · No app needed · Zone 4",foot:"Sticker applied over the printed panel on the meter",badge:"Municipal parking"},
  scanned:"http://parking-zone4-pay.cc/quickpay",
},
{
  id:"q2", category:"qr", difficulty:"medium", type:"qr",
  title:"Refund QR from a seller",
  poster:{heading:"SCAN TO RECEIVE YOUR ₹1,240 REFUND",sub:"Customer support sent this code to return your money",foot:"Received in a chat with 'Kettle & Co Support'",badge:"Refund"},
  scanned:"upi://pay?pa=refund.desk@axlpay&am=1240.00&cu=INR",
},
{
  id:"q3", category:"qr", difficulty:"medium", type:"qr",
  title:"Symposium registration poster",
  poster:{heading:"CYBERSECURITY SYMPOSIUM 2026",sub:"Register free · 24–25 October · Main Auditorium",foot:"Printed URL below the code: events.vidyanagar-institute.edu/symposium",badge:"Vidyanagar Institute"},
  scanned:"https://events.vidyanagar-institute.edu/symposium",
},
{
  id:"q4", category:"qr", difficulty:"hard", type:"qr",
  title:"Reward QR inside an email",
  poster:{heading:"YOUR ₹500 LOYALTY REWARD IS WAITING",sub:"Scan with your phone camera to claim before it expires",foot:"Email from rewards@kettleandco-rewards.net · no link provided",badge:"Kettle & Co Rewards"},
  scanned:"https://kettleandco-rewards.net/claim?token=ax91f",
},

/* ---------------------- AI PHISHING ---------------------- */
{
  id:"a1", category:"ai", difficulty:"medium", type:"email",
  title:"Polished vendor email",
  sender:{name:"Priya Raghavan · Helix Supplies", email:"p.raghavan@helix-supplies-billing.com", initials:"PR", color:"#1b4d3a"},
  subject:"Updated bank details for invoice HX-2291",
  date:"Today, 11:18",
  body:`<p>Dear Accounts team,</p>
    <p>I hope this message finds you well. Following our recent migration to a new banking partner, I'm writing to let you know that remittances for outstanding invoices should now be directed to our updated account.</p>
    <p>Invoice <b>HX-2291</b> (₹2,84,500) remains open. The revised account details are set out in the attached letter on our letterhead, countersigned by our finance director.</p>
    <p>Please confirm once the payee record has been updated on your side. I'm happy to answer any questions.</p>
    <p><span class="attach">📎 Helix_Updated_Banking_Details.pdf · 240 KB</span></p>
    <p class="sig">Priya Raghavan · Accounts Receivable · Helix Supplies</p>`,
},
{
  id:"a2", category:"ai", difficulty:"hard", type:"sms",
  title:"Message from the principal",
  from:"+91 91xxx 33718",
  messages:[
    {text:"Hi, this is Dr. Menon, Principal. I'm in a board meeting and can't take calls. Are you available for a quick task?"},
    {text:"I need 6 digital gift vouchers of Rs 5,000 each for the guest speakers today. Please purchase them now and send me the codes - I'll process the reimbursement through the office this evening. Keep this between us until the ceremony."}
  ],
  stamp:"WhatsApp · unsaved number · profile photo matches the college website",
},
{
  id:"a3", category:"ai", difficulty:"hard", type:"email",
  title:"Support chat follow-up",
  sender:{name:"Nimbus Drive Support", email:"support@nimbusdrive.help-desk.io", initials:"NS", color:"#25406b"},
  subject:"Re: Ticket #884120 — continuing our chat about your sync issue",
  date:"Today, 15:26",
  body:`<p>Hi,</p>
    <p>Thanks for your patience earlier on chat. As discussed, the sync failure is caused by a stale authentication token on your device.</p>
    <p>To resolve it, our engineer will need a short remote session. Please install the support viewer below and share the 9-digit session ID with us, then approve the connection prompt.</p>
    <p><span class="attach">📎 NimbusSupportViewer_setup.msi · 6.4 MB</span></p>
    <p>During the session we'll ask you to sign in normally so we can confirm the token refresh. This takes about 5 minutes.</p>
    <p class="sig">Nimbus Drive Support · Ticket #884120</p>`,
},
{
  id:"a4", category:"ai", difficulty:"medium", type:"email",
  title:"Subscription renewal notice",
  sender:{name:"Lumen AI Billing", email:"billing@lumen-ai-account.com", initials:"LA", color:"#3a2b5c"},
  subject:"Your Lumen AI Pro plan renewed — ₹8,499 charged",
  date:"Today, 06:12",
  body:`<div class="brandlogo"><span class="sq" style="background:#8b6bff">L</span> Lumen AI</div>
    <p>Your annual <b>Lumen AI Pro</b> subscription has renewed. ₹8,499 has been charged to the card ending in 4417.</p>
    <p>Didn't authorise this? Cancel within 24 hours for a full refund.</p>
    <p><button class="fakebtn" disabled>Cancel subscription and refund</button></p>
    <p style="font-size:.85rem">Or call our billing helpline: <b>1800-xxx-3390</b></p>
    <p class="sig">Lumen AI Billing · Invoice LAI-77412</p>`,
},
{
  id:"a5", category:"email", difficulty:"hard", type:"email",
  title:"Payroll correction with spoofed headers",
  sender:{name:"Vidyanagar Institute Payroll", email:"payroll@vidyanagar-institute.edu", initials:"VI", color:"#2b3a52"},
  subject:"Action required: confirm direct-deposit details",
  date:"Today, 08:17",
  body:`<p>Dear colleague,</p>
    <p>A payroll audit found a mismatch in your direct-deposit record. Confirm your campus password and bank details by 17:00 today to avoid a delay in your next payment.</p>
    <p><b>Destination:</b> <span class="fakelink">https://vidyanagar-institute.edu.payroll-correction.net/confirm</span></p>
    <div class="mail-headers"><b>Message headers (received by the campus mail server)</b>
      <code>Reply-To: payroll.audit@vidyanagar-payroll.com</code>
      <code>Return-Path: bounce@vidyanagar-payroll.com</code>
      <code>Authentication-Results: mx.vidyanagar-institute.edu; spf=pass smtp.mailfrom=vidyanagar-payroll.com; dkim=pass header.d=vidyanagar-payroll.com; dmarc=fail header.from=vidyanagar-institute.edu</code>
    </div>
    <p class="sig">Payroll Office · Vidyanagar Institute</p>`,
},
{
  id:"e10", category:"email", difficulty:"hard", type:"email",
  title:"Card transaction alert",
  sender:{name:"Aurora Bank Alerts", email:"alerts@aurorabank.in", initials:"AB", color:"#1b3a6b"},
  subject:"Debit of \u20b91,499.00 on card ending 8842",
  date:"Today, 12:04",
  body:`<div class="brandlogo"><span class="sq" style="background:#e8b23a">A</span> AURORA BANK</div>
    <p>Dear Ananya,</p>
    <p>A debit of <b>\u20b91,499.00</b> was made on your card ending <b>8842</b> at KETTLE AND CO on 16 Sep at 12:04. Available balance and full statement are visible in the Aurora Bank app.</p>
    <p>If you recognise this transaction, no action is needed.</p>
    <p>If you do not, block the card from the app under Cards &rsaquo; Manage, or call the 24x7 number printed on the back of your card. We will never call you to ask for your PIN, OTP or card number.</p>
    <p class="sig">Aurora Bank \u00b7 Automated alert \u00b7 Reference TXN-8842-40218</p>`,
},
{
  id:"b1", category:"email", difficulty:"easy", type:"email",
  title:"Student portal password expiry",
  sender:{name:"Campus IT Desk", email:"itdesk@vidyanagar-password.help", initials:"IT", color:"#2b3a52"},
  subject:"Your student account expires tonight",
  date:"Today, 08:12",
  body:`<p>Hello student,</p>
    <p>Your campus account will be disabled at midnight. Confirm your password now to keep access to classes and results.</p>
    <p><button class="fakebtn" disabled>KEEP MY ACCOUNT</button></p>
    <p><span class="fakelink">https://vidyanagar-password.help/keep-account</span></p>
    <p class="sig">Campus IT Desk</p>`,
},
{
  id:"b2", category:"email", difficulty:"easy", type:"email",
  title:"Library hours update",
  sender:{name:"College Library", email:"library@vidyanagar-institute.edu", initials:"CL", color:"#2b4d3a"},
  subject:"Reading room closes at 6 p.m. on Friday",
  date:"Tue, 11:20",
  body:`<p>Students,</p>
    <p>The reading room will close at 6 p.m. this Friday for scheduled maintenance. The book-return box at the main entrance will remain available.</p>
    <p>No account action is needed. Regular hours resume Saturday.</p>
    <p class="sig">College Library · Vidyanagar Institute</p>`,
},
{
  id:"b3", category:"sms", difficulty:"easy", type:"sms",
  title:"Parcel held for a small fee",
  from:"+91 98xxx 44102",
  messages:[
    {text:"SwiftPost: parcel SP-531884 is on hold because the address needs confirmation."},
    {text:"Pay ₹25 within 3 hours to reschedule: swiftpost-track-fee.info/SP531884"}
  ],
  stamp:"SMS · unknown sender",
},
{
  id:"b4", category:"email", difficulty:"easy", type:"email",
  title:"Exam timetable attachment",
  sender:{name:"Examination Cell", email:"exam.cell@vidyanagar-institute.edu", initials:"VI", color:"#2b4d3a"},
  subject:"Updated timetable — please open the attached archive",
  date:"Today, 09:06",
  body:`<p>Dear students,</p>
    <p>The examination timetable has changed. Open the attached <b>Timetable_Update.zip</b> and follow the instructions inside before 5 p.m.</p>
    <p class="attach">📎 Timetable_Update.zip · 84 KB</p>
    <p class="sig">Examination Cell</p>`,
},
{
  id:"b5", category:"website", difficulty:"easy", type:"website",
  title:"Campus portal opened from a bookmark",
  url:"https://portal.vidyanagar-institute.edu",
  secure:true,
  site:{brand:"Vidyanagar Institute",color:"#247a62",heading:"Student Portal",note:"Sign in to view your timetable and notices.",popup:"",fields:["Institute email","Password"]},
},
{
  id:"b6", category:"qr", difficulty:"easy", type:"qr",
  title:"Library guest Wi-Fi poster",
  poster:{badge:"COLLEGE LIBRARY",heading:"Guest Wi-Fi",sub:"Connect to the visitor network. No account password is needed.",foot:"Questions? Ask the library desk."},
  scanned:"https://wifi.vidyanagar-institute.edu/guest",
},
{
  id:"b7", category:"sms", difficulty:"easy", type:"sms",
  title:"One-time code requested by support",
  from:"+91 80xxx 90514",
  messages:[
    {text:"Campus IT: we are checking your account lockout."},
    {text:"Please reply with the six-digit code just sent to your phone so we can restore your access."}
  ],
  stamp:"SMS · sender not saved",
},
{
  id:"m1", category:"qr", difficulty:"medium", type:"qr",
  title:"Scholarship QR code asks for account access",
  poster:{badge:"STUDENT AID",heading:"Confirm your scholarship payment",sub:"Scan to prevent your grant from being paused today.",foot:"Questions? Call the number printed here: 1800-xxx-6201"},
  scanned:"https://vidyanagar-aid-verify.co/student/confirm",
},
{
  id:"m2", category:"sms", difficulty:"medium", type:"sms",
  title:"Unexpected MFA approval prompt",
  from:"Nimbus Drive security",
  messages:[
    {text:"A sign-in approval was requested for your account from a new Android device in another city."},
    {text:"If this was not you, deny the request in the Nimbus Drive app and change your password from the official site. We will never ask you to share an approval code."}
  ],
  stamp:"Notification · opened from the installed Nimbus Drive app",
},
{
  id:"m3", category:"email", difficulty:"medium", type:"email",
  title:"Shared document requests a new sign-in",
  sender:{name:"Nimbus Drive", email:"sharing@nimbusdrive.com", initials:"ND", color:"#25406b"},
  subject:"A classmate shared “Lab Notes — Week 4” with you",
  date:"Today, 14:22",
  body:`<p>A classmate shared a document with your campus account.</p>
    <p><button class="fakebtn" disabled>VIEW DOCUMENT</button></p>
    <p>Document preview is unavailable. Sign in again to continue.</p>
    <p style="font-size:.85rem">Destination preview: <span class="fakelink">https://nimbusdrive.com.login-check.support/view/4b81</span></p>
    <p class="sig">Nimbus Drive sharing notification</p>`,
}
];

/* ------------- Red flag hunt scenarios ------------- */
const HUNTS = [
{
  id:"h1", title:"Bank alert email", subtitle:"Five clues are hiding in this message.", icon:"📧",
  total:5,
  html:`<div class="mock mail">
    <div class="mock-head"><span class="dot"></span><span class="dot"></span><span class="dot"></span><span class="label">Inbox — Mail</span></div>
    <div class="mail-top">
      <div class="mail-subject"><span class="hot" data-note="The subject combines a threat with a deadline. Urgency is engineered to stop you from checking anything." data-name="Urgent threatening subject">Final notice: your account will be closed in 24 hours</span></div>
      <div class="mail-from">
        <div class="avatar" style="background:#3a1b1b">AB</div>
        <div class="who">
          <div class="nm">Aurora Bank Support</div>
          <div class="ad"><span class="hot" data-note="The domain is aurora-bank-support.help — a lookalike, not the bank's own domain." data-name="Lookalike sender domain">support@aurora-bank-support.help</span></div>
        </div>
        <div class="mail-date">Today, 04:02</div>
      </div>
    </div>
    <div class="mail-body">
      <p><span class="hot" data-note="A real bank addresses you by name. A generic greeting means the message went to thousands of people." data-name="Generic greeting">Dear Customer,</span></p>
      <p>We have detected unusual activity on your account. Your acount has been temporarily limited and will be <span class="hot" data-note="&quot;Acount&quot; is misspelled, and closure threats like this are a pressure tactic rather than real banking policy." data-name="Spelling error and closure threat">permanently closed</span> unless verification is completed.</p>
      <p>Please confirm your identity by opening the secure portal below.</p>
      <p><button class="fakebtn" disabled>Verify my account</button></p>
      <p style="font-size:.85rem"><span class="hot" data-note="The visible text says the bank's name, but the address goes to secure-verify.xyz over plain http." data-name="Deceptive link destination"><span class="fakelink">http://aurorabank.secure-verify.xyz/login</span></span></p>
      <p class="sig">Aurora Bank · Automated security message</p>
    </div>
  </div>`
},
{
  id:"h2", title:"Delivery text message", subtitle:"Four clues in three short lines.", icon:"📱",
  total:4,
  html:`<div class="phone">
    <div class="phone-top">Messages<b><span class="hot" data-note="Couriers send from a registered short sender ID. A personal mobile number means anyone could have sent this." data-name="Personal mobile number as sender">+91 82xxx 47119</span></b></div>
    <div class="bubble">SwiftPost: your parcel is held at the depot. <span class="hot" data-note="A ₹28 &quot;customs fee&quot; is the bait — the payment page exists to capture your full card details." data-name="Small payment request">A customs fee of Rs 28 is due</span> before release.</div>
    <div class="bubble"><span class="hot" data-note="A shortened link hides where it really goes. Couriers link to their own tracking domain." data-name="Shortened link">Pay here: bit.ly/sp-clear-28</span></div>
    <div class="bubble"><span class="hot" data-note="&quot;Returned today&quot; is an invented deadline designed to make you pay before you think." data-name="Artificial deadline">Unpaid parcels are returned today.</span></div>
    <div class="stamp">Received 05:19 · unknown sender</div>
  </div>`
},
{
  id:"h3", title:"Login page", subtitle:"Five clues across the page and its address.", icon:"🌐",
  total:5,
  html:`<div class="mock">
    <div class="mock-head"><span class="dot"></span><span class="dot"></span><span class="dot"></span><span class="label">Browser</span></div>
    <div class="urlbar">
      <div class="urlbox"><span class="sec-bad">⚠ Not secure</span><span class="hot" data-note="No HTTPS, and the real domain is login-verify.top — the bank name is only a subdomain of it." data-name="Insecure, lookalike domain">http://aurorabank.login-verify.top/netbanking</span></div>
    </div>
    <div class="sitebody">
      <div class="brandlogo" style="justify-content:center"><span class="sq" style="background:#e8b23a">A</span> <span class="hot" data-note="The logo is a low-quality copy and the brand name is spelled &quot;AURORA BANK LTD.&quot; — a detail the real bank doesn't use." data-name="Imitated logo">AURORA BANK LTD.</span></div>
      <p style="color:#b9c9d8;font-size:.92rem">Sign in to continue</p>
      <div class="popup"><span class="hot" data-note="A popup inventing a security problem is a pressure device. Real banks don't interrupt their own login page." data-name="Alarming popup">⚠ Your session is at risk. Verify now to avoid lockout.</span></div>
      <span class="field">Customer ID</span>
      <span class="field">Password</span>
      <span class="field"><span class="hot" data-note="No bank login page needs your ATM PIN. That field exists only to harvest it." data-name="Asks for ATM PIN">ATM PIN</span></span>
      <p style="margin-top:14px"><span class="hot" data-note="A countdown on a login page exists to rush you past the checks you would otherwise make." data-name="Countdown timer">Session expires in 02:41</span></p>
      <p style="color:#5d7183;font-size:.78rem;margin-top:10px">Visual mockup only — these fields are not real and accept no input.</p>
    </div>
  </div>`
}
];

/* ------------- Compare scenarios ------------- */
const COMPARES = [
{
  id:"c1", label:"Bank sign-in", context:"You tapped a link in an email about your bank account. One of these opened. Which would you trust?",
  a:{url:"http://aurora-bank.secure-login.cc/net", secure:false, brand:"AURORA BANK", color:"#e8b23a",
     heading:"Net Banking Login", note:"Session expires in 03:12", popup:"⚠ Unverified device detected", fields:["Customer ID","Password","ATM PIN"]},
  b:{url:"https://netbanking.aurorabank.in/login", secure:true, brand:"AURORA BANK", color:"#e8b23a",
     heading:"Net Banking", note:"Last login: 14 Sep, 19:12", popup:"", fields:["Customer ID","Password"]},
  correct:"b",
  points:[
    "Site A has no HTTPS at all; the browser marks it 'Not secure'.",
    "Site A's real domain is <code>secure-login.cc</code> — the bank's name is just a subdomain in front of it. Site B's registrable domain is <code>aurorabank.in</code>.",
    "Site A asks for your ATM PIN. No banking website needs it.",
    "Site A uses a countdown and a warning popup to rush you; Site B shows a calm last-login line instead."
  ]
},
{
  id:"c2", label:"Social login", context:"Two pages both claim to be Pulse. Look closely at the address before you choose.",
  a:{url:"https://pulse.com/login", secure:true, brand:"Pulse", color:"#c44ad6",
     heading:"Log in to Pulse", note:"Continue with email", popup:"", fields:["Email or phone","Password"]},
  b:{url:"https://pulse-com.login-secure.app/auth", secure:true, brand:"Pulse", color:"#c44ad6",
     heading:"Log in to Pulse", note:"Verify your identity to continue", popup:"Your account will be locked in 5 minutes", fields:["Email or phone","Password","6-digit code"]},
  correct:"a",
  points:[
    "Both pages have HTTPS. The padlock proves encryption, never ownership — it cannot separate these two.",
    "Site B's dot-com has become a hyphen: <code>pulse-com</code> is merely a subdomain of <code>login-secure.app</code>.",
    "Site B asks for your 6-digit code, so it can use your second factor in real time while you're on the page.",
    "Site B adds a five-minute lockout threat. Site A asks for nothing beyond a normal login."
  ]
},
{
  id:"c3", label:"Shop checkout", context:"You're buying a ₹1,240 pour-over. Both pages ask for a card. Which checkout is safe to use?",
  a:{url:"https://www.kettleandco.in/checkout/payment", secure:true, brand:"Kettle & Co", color:"#d98a3a",
     heading:"Payment", note:"Order KC-40218 · ₹1,240 · Nashik 422001", popup:"", fields:["Card number","Expiry / CVV"]},
  b:{url:"https://kettleandco.in.pay-fast.io/checkout", secure:true, brand:"Kettle & Co", color:"#d98a3a",
     heading:"Complete your payment", note:"Offer ends in 09:58 — price may change", popup:"Card declined? Try a different card to keep your discount", fields:["Card number","Expiry / CVV","Card PIN"]},
  correct:"a",
  points:[
    "Site B's domain is <code>pay-fast.io</code>. Putting <code>kettleandco.in</code> in front of it changes nothing about who owns the page.",
    "Site B asks for your card PIN, which no online checkout requires.",
    "Site B's 'try a different card' prompt is designed to harvest several cards from one victim.",
    "Site A shows your real order number, amount and delivery pincode, and applies no time pressure."
  ]
}
];

/* ------------- Learn + flags + checklist content ------------- */
const LEARN = [
 ["What is phishing?","A cyberattack that tricks people into revealing information or taking unsafe actions — usually by impersonating an organisation you already trust. It targets your judgement rather than your software, which is why it works on fully patched systems."],
 ["What is smishing?","Phishing delivered by SMS or chat. Messages are short, so attackers lean on shortened links, fake sender names and deadlines. Phones make it worse: truncated addresses, and you're usually distracted."],
 ["What is vishing?","Phishing over a voice call. A caller impersonates your bank, a delivery company or an official and works through a script, often after an SMS has already primed you. The call is the moment most people hand over an OTP."],
 ["What is quishing?","Phishing using QR codes. Because a code is unreadable to humans, the check has to happen in the URL preview after you scan. Attackers also stick codes over real ones on meters, posters and restaurant tables."],
 ["What is spear phishing?","Targeted phishing aimed at one person or organisation, built from details gathered beforehand — your course, your manager's name, a project you posted about. It's rarer, far more convincing, and usually arrives with correct context."],
 ["What is AI phishing?","Phishing written or enhanced with AI: fluent, correctly formatted, personalised at scale and available in any language. It removes the spelling mistakes people were taught to look for, so the request itself has to become the test."],
 ["What is business email compromise?","An attacker impersonates an executive or a supplier to redirect a payment — new bank details for an invoice, an urgent transfer, gift-card codes. Losses are large because everything looks like routine business."]
];

const FLAGCARDS = [
 ["Suspicious sender address","The display name is free text an attacker chooses. Open the actual address and read the domain after the @ character by character."],
 ["Urgent language","Deadlines, countdowns and threats of closure exist to stop you from checking. Real organisations give you time; attackers cannot afford to."],
 ["Unexpected attachments","Especially executables, macro-enabled documents, or double extensions like <code>.pdf.exe</code>. If you didn't ask for a file, don't open it."],
 ["Suspicious URLs","Read right to left from the first single slash. The two labels just before it are the real owner. Everything to the left can say anything."],
 ["Requests for OTP or password","No legitimate staff member ever needs either, in any channel. This single rule stops most account takeovers on its own."],
 ["Fake rewards","Prizes from draws you never entered, refunds you never claimed, badges you never applied for. If it arrived unearned, it's bait."],
 ["Grammar inconsistencies","Still useful for low-effort campaigns, but AI has made fluent phishing normal. Treat clean writing as neutral evidence, not reassurance."],
 ["Unusual payment requests","Changed bank details, gift cards, crypto, or a small 'processing fee'. Any change to where money goes must be confirmed by voice on a known number."],
 ["Fake login pages","A pixel-perfect copy on a lookalike domain, often with a valid padlock. Reach login pages from your own bookmarks or the app instead."],
 ["Mismatched domains","The brand in the message, the sender's domain and the link's domain should agree. When they don't, the message is impersonation."]
];

const CHECKS = [
 ["Check the sender","Expand the address and read the full domain, not the display name."],
 ["Check the domain","Find the registrable domain — the two labels before the first single slash."],
 ["Hover over links","See the destination before you click. On mobile, long-press to preview."],
 ["Be suspicious of urgency","Deadlines are the most reliable sign that someone doesn't want you to verify."],
 ["Never share OTP or password","Not by phone, not by chat, not to 'support'. No exceptions."],
 ["Verify unexpected requests","Use a number or account you already had — never one supplied in the message."],
 ["Avoid unknown attachments","Check the real file extension. Don't enable macros on request."],
 ["Use official websites and apps","Navigate there yourself. Bookmarks beat links every time."]
];

const CATS = [
 ["email","📧","Email phishing","Fake alerts, invoices, offers and password resets. Inspect the sender, the link and the request."],
 ["sms","📱","Smishing","Malicious SMS and chat messages — short, urgent, and built around a shortened link."],
 ["website","🌐","Fake websites","Lookalike login and payment pages. Read the address bar the way an attacker hopes you won't."],
 ["qr","📲","Quishing","QR-code attacks, from payment codes to stickers placed over the real thing."],
 ["ai","🤖","AI phishing","Fluent, personalised messages with nothing to catch in the grammar. Judge the request instead."],
 ["mixed","🎲","Mixed mode","Every category, shuffled. The closest thing here to a real inbox."]
];
