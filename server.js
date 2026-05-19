const express = require("express");
const axios = require("axios");
const cors = require("cors");
const crypto = require("crypto");

const app = express();
app.use(express.json());
app.use(cors());

const INTASEND_PUBLISHABLE_KEY = "ISPubKey_live_4c2de7f0-fd2a-4028-b7fe-ff36419fa0cf";
const INTASEND_SECRET_KEY      = "ISSecretKey_live_fca0b164-345f-4a59-8201-b031aa5752f1";
const INTASEND_BASE            = "https://payment.intasend.com/api/v1";

// Store pending payments in memory
const pendingPayments = {};

// ── 1. Initiate STK Push ──────────────────────────────────────────────────────
app.post("/api/pay", async (req, res) => {
  const { phone } = req.body;
  if (!phone || phone.length < 9) {
    return res.status(400).json({ success: false, message: "Invalid phone number" });
  }

  // Convert 07xx to 2547xx
  const formattedPhone = phone.startsWith("0")
    ? "254" + phone.slice(1)
    : phone;

  const reference = "FOLIO-" + crypto.randomBytes(4).toString("hex").toUpperCase();

  try {
    const response = await axios.post(
      `${INTASEND_BASE}/payment/mpesa_stk_push/`,
      {
        public_key: INTASEND_PUBLISHABLE_KEY,
        amount: 999,
        phone_number: formattedPhone,
        api_ref: reference,
        narrative: "Folio Premium Subscription",
      },
      {
        headers: {
          Authorization: `Bearer ${INTASEND_SECRET_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    const invoiceId = response.data?.invoice?.invoice_id || response.data?.id;
    pendingPayments[reference] = { status: "pending", phone, invoiceId };

    return res.json({ success: true, reference, invoiceId });

  } catch (err) {
    console.error("STK error:", err?.response?.data || err.message);
    return res.status(500).json({
      success: false,
      message: err?.response?.data?.detail || "Payment initiation failed",
    });
  }
});

// ── 2. Poll payment status ────────────────────────────────────────────────────
app.get("/api/status/:reference", async (req, res) => {
  const payment = pendingPayments[req.params.reference];
  if (!payment) return res.status(404).json({ status: "not_found" });

  try {
    if (payment.invoiceId) {
      const statusRes = await axios.get(
        `${INTASEND_BASE}/payment/status/${payment.invoiceId}/`,
        {
          headers: { Authorization: `Bearer ${INTASEND_SECRET_KEY}` },
        }
      );
      const state = statusRes.data?.invoice?.state || statusRes.data?.state;
      if (state === "COMPLETE") payment.status = "success";
      else if (state === "FAILED" || state === "CANCELLED") payment.status = "failed";
    }
  } catch (e) {
    console.error("Status check error:", e?.response?.data || e.message);
  }

  return res.json({ status: payment.status, reference: req.params.reference });
});

// ── 3. IntaSend Webhook callback ──────────────────────────────────────────────
app.post("/api/callback", (req, res) => {
  const body = req.body;
  console.log("IntaSend callback:", JSON.stringify(body, null, 2));
  const reference = body?.api_ref;
  const state = body?.state || body?.invoice?.state;
  if (reference && pendingPayments[reference]) {
    if (state === "COMPLETE") pendingPayments[reference].status = "success";
    else if (state === "FAILED" || state === "CANCELLED") pendingPayments[reference].status = "failed";
  }
  res.status(200).json({ status: "received" });
});

// ── 4. Health check ───────────────────────────────────────────────────────────
app.get("/", (req, res) => res.json({ message: "Folio payment server running ✅" }));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Folio server running on port ${PORT}`));
