import os
import smtplib
import uuid
import time
import hashlib
import hmac
import secrets
import re
from email.message import EmailMessage
from pathlib import Path
from urllib.parse import urlparse

from flask import Flask, jsonify, request
import requests
import razorpay


def load_local_env_file():
    env_path = Path(__file__).resolve().parent / ".env"
    if not env_path.exists():
        return

    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue

        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


load_local_env_file()

app = Flask(__name__)
PHONE_OTP_STORE = {}
UUID_REGEX = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$"
)


@app.after_request
def apply_cors_headers(response):
    def parse_origin_entry(raw_value):
        token = str(raw_value or "").strip().rstrip("/")
        if not token:
            return None
        if token == "*":
            return {"raw": "*", "canonical": "*", "host": "*"}

        normalized = token if "://" in token else f"https://{token}"
        parsed = urlparse(normalized)
        host = (parsed.netloc or "").lower()
        scheme = (parsed.scheme or "https").lower()
        canonical = f"{scheme}://{host}" if host else ""
        return {
            "raw": token,
            "canonical": canonical,
            "host": host,
        }

    def origin_host_matches(request_host, allowed_host):
        if not request_host or not allowed_host:
            return False
        if allowed_host == request_host:
            return True
        if allowed_host.startswith("*."):
            suffix = allowed_host[2:]
            return request_host == suffix or request_host.endswith(f".{suffix}")
        # Vercel preview domains rotate frequently; treat them as same trust family.
        if allowed_host.endswith(".vercel.app") and request_host.endswith(".vercel.app"):
            return True
        return False

    configured_origins = [
        parse_origin_entry(origin)
        for origin in os.getenv("FRONTEND_ORIGIN", "").split(",")
    ]
    configured_origins = [entry for entry in configured_origins if entry]

    request_origin = request.headers.get("Origin", "").strip().rstrip("/")
    request_entry = parse_origin_entry(request_origin)

    allowed_origin = "*"
    if configured_origins:
        wildcard = next((entry for entry in configured_origins if entry["raw"] == "*"), None)
        if wildcard:
            allowed_origin = "*"
        else:
            matched = None
            if request_origin and request_entry:
                for entry in configured_origins:
                    if entry["canonical"] and request_origin.lower() == entry["canonical"]:
                        matched = entry
                        break
                    if origin_host_matches(request_entry["host"], entry["host"]):
                        matched = entry
                        break

            if matched and request_origin:
                allowed_origin = request_origin
            else:
                fallback = configured_origins[0].get("canonical") or configured_origins[0].get("raw")
                allowed_origin = fallback or "*"
    elif request_origin:
        allowed_origin = request_origin

    response.headers["Access-Control-Allow-Origin"] = allowed_origin

    response.headers["Access-Control-Allow-Headers"] = "Content-Type,Authorization"
    response.headers["Access-Control-Allow-Methods"] = "GET,POST,OPTIONS"
    return response


def is_blank(value):
    return not isinstance(value, str) or value.strip() == ""


def normalize_uuid_or_none(value):
    raw = str(value or "").strip()
    if not raw:
        return None
    return raw if UUID_REGEX.match(raw) else None


def normalize_int_or_none(value):
    if value in (None, ""):
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def normalize_guide_id_or_none(value):
    if value in (None, ""):
        return None

    uuid_value = normalize_uuid_or_none(value)
    if uuid_value:
        return uuid_value

    int_value = normalize_int_or_none(value)
    if int_value is not None:
        return int_value

    raw = str(value).strip()
    return raw or None


def get_twilio_config():
    account_sid = os.getenv("TWILIO_ACCOUNT_SID", "").strip()
    auth_token = os.getenv("TWILIO_AUTH_TOKEN", "").strip()
    from_number = os.getenv("TWILIO_PHONE_NUMBER", "").strip()
    verify_service_sid = os.getenv("TWILIO_VERIFY_SERVICE_SID", "").strip()

    if not account_sid or not auth_token:
        raise RuntimeError(
            "Twilio is not configured. Set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN."
        )

    if not account_sid.startswith("AC"):
        raise RuntimeError(
            "TWILIO_ACCOUNT_SID must be your Twilio Account SID and should start with AC."
        )

    return {
        "account_sid": account_sid,
        "auth_token": auth_token,
        "from_number": from_number,
        "verify_service_sid": verify_service_sid,
    }


def send_support_email(subject, message, sender_name="", sender_email="", ticket_id=""):
    smtp_host = os.getenv("SMTP_HOST", "smtp.gmail.com")
    smtp_port = int(os.getenv("SMTP_PORT", "587"))
    smtp_user = os.getenv("SMTP_USER", "")
    smtp_password = os.getenv("SMTP_PASSWORD", "").replace(" ", "")
    support_to = os.getenv("SUPPORT_TO_EMAIL", smtp_user)

    if not smtp_user or not smtp_password or not support_to:
        raise RuntimeError(
            "Support email is not configured. Set SMTP_USER, SMTP_PASSWORD, and SUPPORT_TO_EMAIL."
        )

    email = EmailMessage()
    clean_subject = subject.strip()
    safe_ticket_id = ticket_id.strip() if isinstance(ticket_id, str) else ""
    if safe_ticket_id:
        email["Subject"] = f"[ReGuide Support][{safe_ticket_id}] {clean_subject}"
    else:
        email["Subject"] = f"[ReGuide Support] {clean_subject}"
    email["From"] = smtp_user
    email["To"] = support_to
    if isinstance(sender_email, str) and sender_email.strip():
        email["Reply-To"] = sender_email.strip()

    body_lines = [
        "New support request from ReGuide:\n",
        f"Name: {sender_name.strip() if isinstance(sender_name, str) else ''}",
        f"Email: {sender_email.strip() if isinstance(sender_email, str) else ''}",
        "",
        "Message:",
        message.strip(),
    ]

    email.set_content("\n".join(body_lines))

    with smtplib.SMTP(smtp_host, smtp_port) as server:
        server.starttls()
        server.login(smtp_user, smtp_password)
        server.send_message(email)


def parse_positive_amount_rupees(value):
    try:
        amount = float(value)
    except (TypeError, ValueError):
        return None
    if amount <= 0:
        return None
    return amount


def get_razorpay_client():
    key_id = os.getenv("RAZORPAY_KEY_ID", "").strip()
    key_secret = os.getenv("RAZORPAY_KEY_SECRET", "").strip()

    if not key_id or not key_secret:
        raise RuntimeError("Razorpay is not configured. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.")

    client = razorpay.Client(auth=(key_id, key_secret))
    return client, key_id, key_secret


def get_supabase_config():
    base_url = os.getenv("SUPABASE_URL", "").strip()
    service_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip()

    if not base_url or not service_key:
        raise RuntimeError("Supabase backend is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.")

    return base_url.rstrip("/"), service_key


def build_supabase_headers(service_key):
    return {
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }


def extract_missing_column_name(error_message):
    message = str(error_message or "")

    # Supabase/PostgREST schema-cache error format:
    # "Could not find the 'payment_id' column of 'orders' in the schema cache"
    quoted_column = re.search(r"'([A-Za-z_][A-Za-z0-9_]*)'\s+column", message)
    if quoted_column:
        return quoted_column.group(1)

    quoted_of_table = re.search(r"'([A-Za-z_][A-Za-z0-9_]*)'\s+column\s+of\s+'[A-Za-z_][A-Za-z0-9_]*'", message)
    if quoted_of_table:
        return quoted_of_table.group(1)

    generic_quoted = re.search(r"column\s+['\"]([A-Za-z_][A-Za-z0-9_]*)['\"]", message)
    if generic_quoted:
        return generic_quoted.group(1)

    marker = "column "
    if marker not in message:
        return ""
    tail = message.split(marker, 1)[1]
    if '"' in tail:
        quoted = tail.split('"', 2)
        if len(quoted) >= 2:
            return quoted[1]
    if " does not exist" in tail:
        return tail.split(" does not exist", 1)[0].strip()
    return ""


def post_to_supabase_table(table_name, payload):
    base_url, service_key = get_supabase_config()
    url = f"{base_url}/rest/v1/{table_name}"
    response = requests.post(url, headers=build_supabase_headers(service_key), json=payload, timeout=20)

    if response.status_code >= 400:
        try:
            details = response.json()
        except Exception:
            details = {"message": response.text}
        raise RuntimeError(details.get("message") or details.get("error") or str(details))

    data = response.json()
    if isinstance(data, list) and data:
        return data[0]
    return data


def insert_order_with_fallback(order_row):
    # Optional columns are removed when not yet migrated in DB.
    optional_columns = ["payment_id", "payment_status", "razorpay_order_id", "razorpay_signature"]
    payload = dict(order_row or {})

    while True:
        try:
            return post_to_supabase_table("orders", payload)
        except RuntimeError as err:
            missing_column = extract_missing_column_name(str(err))
            if missing_column and missing_column in optional_columns and missing_column in payload:
                payload.pop(missing_column, None)
                continue
            raise


def insert_rental_with_fallback(rental_row):
    optional_columns = ["refund_status", "refund_amount", "refunded_at"]
    payload = dict(rental_row or {})

    while True:
        try:
            return post_to_supabase_table("rentals", payload)
        except RuntimeError as err:
            message = str(err)
            if "relation \"rentals\" does not exist" in message.lower():
                return None

            missing_column = extract_missing_column_name(message)
            if missing_column and missing_column in optional_columns and missing_column in payload:
                payload.pop(missing_column, None)
                continue

            raise


def insert_wallet_transaction_with_fallback(wallet_row):
    optional_columns = ["rental_id", "note", "status"]
    payload = dict(wallet_row or {})

    while True:
        try:
            return post_to_supabase_table("wallet_transactions", payload)
        except RuntimeError as err:
            message = str(err)
            if "relation \"wallet_transactions\" does not exist" in message.lower():
                return None

            missing_column = extract_missing_column_name(message)
            if missing_column and missing_column in optional_columns and missing_column in payload:
                payload.pop(missing_column, None)
                continue

            raise


def create_wallet_entries_for_rental_order(order_row, rental_row):
    if not isinstance(order_row, dict):
        return

    order_type = str(order_row.get("order_type") or "").strip().lower()
    deposit_amount = float(order_row.get("deposit") or 0)
    if order_type != "rent" or deposit_amount <= 0:
        return

    order_id = str(order_row.get("id") or "").strip() or None
    rental_id = str((rental_row or {}).get("id") or "").strip() or None
    guide_title = str(order_row.get("guide_title") or "Guide").strip() or "Guide"
    buyer_id = normalize_uuid_or_none(order_row.get("buyer_id"))
    seller_id = normalize_uuid_or_none(order_row.get("seller_id"))

    if buyer_id:
        insert_wallet_transaction_with_fallback(
            {
                "id": str(uuid.uuid4()),
                "user_id": buyer_id,
                "order_id": order_id,
                "rental_id": rental_id,
                "transaction_type": "deposit_paid",
                "amount": deposit_amount,
                "status": "locked",
                "note": f"Deposit paid for {guide_title}",
                "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ"),
            }
        )

    if seller_id:
        insert_wallet_transaction_with_fallback(
            {
                "id": str(uuid.uuid4()),
                "user_id": seller_id,
                "order_id": order_id,
                "rental_id": rental_id,
                "transaction_type": "locked_deposit",
                "amount": deposit_amount,
                "status": "locked",
                "note": f"Deposit locked for {guide_title}",
                "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ"),
            }
        )


def verify_razorpay_signature(payload):
    payment_id = str(payload.get("razorpay_payment_id", "")).strip()
    order_id = str(payload.get("razorpay_order_id", "")).strip()
    signature = str(payload.get("razorpay_signature", "")).strip()

    if not payment_id or not order_id or not signature:
        raise ValueError("Missing payment verification fields.")

    client, _, key_secret = get_razorpay_client()
    # SDK-based verification (recommended by Razorpay)
    client.utility.verify_payment_signature(
        {
            "razorpay_order_id": order_id,
            "razorpay_payment_id": payment_id,
            "razorpay_signature": signature,
        }
    )

    # Additional explicit HMAC check for hard validation.
    expected = hmac.new(
        key_secret.encode("utf-8"),
        f"{order_id}|{payment_id}".encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    if not hmac.compare_digest(expected, signature):
        raise ValueError("Invalid Razorpay signature.")

    payment = client.payment.fetch(payment_id)
    if str(payment.get("order_id", "")).strip() != order_id:
        raise ValueError("Payment does not belong to this Razorpay order.")

    payment_status = str(payment.get("status", "")).lower()
    if payment_status not in ("captured", "authorized"):
        raise ValueError("Payment is not captured/authorized.")

    return payment


def normalize_phone_to_e164(raw_phone):
    phone = str(raw_phone or "").strip()
    phone = re.sub(r"\s+", "", phone)

    if phone.startswith("+"):
        digits = "+" + re.sub(r"\D", "", phone[1:])
        if len(digits) < 8:
            return None
        return digits

    digits = re.sub(r"\D", "", phone)
    if len(digits) == 10:
        # Default to India country code for 10-digit local inputs.
        return f"+91{digits}"
    if len(digits) >= 11:
        return f"+{digits}"
    return None


def send_otp_via_twilio(phone_e164, otp_code):
    twilio = get_twilio_config()

    if twilio["verify_service_sid"]:
        url = f"https://verify.twilio.com/v2/Services/{twilio['verify_service_sid']}/Verifications"
        response = requests.post(
            url,
            auth=(twilio["account_sid"], twilio["auth_token"]),
            data={
                "To": phone_e164,
                "Channel": "sms",
            },
            timeout=20,
        )

        if response.status_code >= 400:
            try:
                payload = response.json()
                msg = payload.get("message") or payload.get("detail") or response.text
            except Exception:
                msg = response.text
            raise RuntimeError(f"Failed to send OTP SMS: {msg}")

        return

    if not twilio["from_number"]:
        raise RuntimeError(
            "Twilio phone number is required when TWILIO_VERIFY_SERVICE_SID is not set."
        )

    body = f"Your ReGuide verification code is {otp_code}. It expires in 5 minutes."
    url = f"https://api.twilio.com/2010-04-01/Accounts/{twilio['account_sid']}/Messages.json"

    response = requests.post(
        url,
        auth=(twilio["account_sid"], twilio["auth_token"]),
        data={
            "To": phone_e164,
            "From": twilio["from_number"],
            "Body": body,
        },
        timeout=20,
    )

    if response.status_code >= 400:
        try:
            payload = response.json()
            msg = payload.get("message") or payload.get("detail") or response.text
        except Exception:
            msg = response.text
        raise RuntimeError(f"Failed to send OTP SMS: {msg}")


def make_phone_otp_key(user_id, phone_e164):
    return f"{str(user_id or '').strip()}::{phone_e164}"

@app.route("/api/health")
def health():
    return jsonify({"status": "ok"})


@app.route("/api/support", methods=["POST", "OPTIONS"])
def support():
    if request.method == "OPTIONS":
        return ("", 204)

    payload = request.get_json(silent=True) or {}
    subject = payload.get("subject", "")
    message = payload.get("message", "")
    sender_name = payload.get("name", "")
    sender_email = payload.get("email", "")

    if is_blank(subject) or is_blank(message):
        return jsonify({"error": "Subject and message are required."}), 400

    ticket_id = f"RG-{uuid.uuid4().hex[:8].upper()}"

    try:
        send_support_email(subject, message, sender_name, sender_email, ticket_id)
        return jsonify({
            "ok": True,
            "message": "Support message sent.",
            "ticketId": ticket_id,
        })
    except smtplib.SMTPAuthenticationError as error:
        print("Support email auth failed:", error)
        smtp_user = os.getenv("SMTP_USER", "your Gmail account")
        return jsonify({
            "error": f"Gmail rejected SMTP login. Check that 2-Step Verification is enabled and SMTP_PASSWORD is a valid Gmail App Password for {smtp_user}."
        }), 500
    except Exception as error:
        print("Support email send failed:", error)
        return jsonify({"error": "Failed to send support message."}), 500


@app.route("/create-order", methods=["POST", "OPTIONS"])
@app.route("/api/create-order", methods=["POST", "OPTIONS"])
def create_order():
    if request.method == "OPTIONS":
        return ("", 204)

    payload = request.get_json(silent=True) or {}

    amount_rupees = parse_positive_amount_rupees(payload.get("amount"))
    order_type = str(payload.get("type", "")).strip().lower()
    guide_id = payload.get("guide_id")

    if amount_rupees is None:
        return jsonify({"error": "Valid amount (in rupees) is required."}), 400

    if order_type not in ("buy", "rent"):
        return jsonify({"error": "type must be either 'buy' or 'rent'."}), 400

    if guide_id in (None, ""):
        return jsonify({"error": "guide_id is required."}), 400

    amount_paise = int(round(amount_rupees * 100))

    try:
        client, key_id, _ = get_razorpay_client()
        notes = {
            "guide_id": str(guide_id),
            "order_type": order_type,
            "created_by": "reguide-backend",
        }
        rp_order = client.order.create(
            {
                "amount": amount_paise,
                "currency": "INR",
                "payment_capture": 1,
                "notes": notes,
            }
        )

        return jsonify(
            {
                "success": True,
                "key": key_id,
                "order_id": rp_order.get("id"),
                "amount": rp_order.get("amount"),
                "currency": rp_order.get("currency", "INR"),
            }
        )
    except Exception as error:
        error_message = str(error) or "Failed to create Razorpay order."
        print("Razorpay create-order failed:", error_message)

        lowered = error_message.lower()
        if "not configured" in lowered or "key" in lowered and "razorpay" in lowered:
            return jsonify({"error": error_message}), 500

        if "authentication" in lowered or "unauthorized" in lowered or "invalid api key" in lowered:
            return jsonify({"error": "Razorpay authentication failed. Check RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET."}), 401

        if "amount" in lowered or "currency" in lowered or "bad request" in lowered:
            return jsonify({"error": error_message}), 400

        return jsonify({"error": error_message}), 500


@app.route("/verify-payment", methods=["POST", "OPTIONS"])
@app.route("/api/verify-payment", methods=["POST", "OPTIONS"])
def verify_payment():
    if request.method == "OPTIONS":
        return ("", 204)

    payload = request.get_json(silent=True) or {}

    try:
        payment = verify_razorpay_signature(payload)

        order_type = str(payload.get("type", payload.get("order_type", "buy"))).strip().lower()
        if order_type not in ("buy", "rent"):
            return jsonify({"error": "order_type must be buy or rent."}), 400

        guide_id_raw = payload.get("guide_id")
        if guide_id_raw in (None, ""):
            return jsonify({"error": "guide_id is required."}), 400

        guide_id = normalize_guide_id_or_none(guide_id_raw)

        buyer_id = normalize_uuid_or_none(payload.get("user_id") or payload.get("buyer_id"))
        buyer_email = str(payload.get("buyer_email", "")).strip().lower()
        buyer_name = str(payload.get("buyer_name", "")).strip()

        if not buyer_id and not buyer_email:
            return jsonify({"error": "user_id or buyer_email is required."}), 400

        seller_id = normalize_uuid_or_none(payload.get("seller_id"))
        seller_name = str(payload.get("seller_name", "")).strip()
        guide_title = str(payload.get("guide_title", "")).strip()

        amount_paise = int(payment.get("amount") or 0)
        amount_rupees = round(amount_paise / 100.0, 2)

        now_iso = time.strftime("%Y-%m-%d")
        order_key = f"order-{int(time.time() * 1000)}"
        order_id_uuid = str(uuid.uuid4())
        order_row = {
            "id": order_id_uuid,
            "order_key": order_key,
            "guide_id": guide_id,
            "guide_title": guide_title,
            "buyer_id": buyer_id,
            "buyer_email": buyer_email,
            "buyer_name": buyer_name,
            "seller_id": seller_id,
            "seller_name": seller_name,
            "order_type": order_type,
            "amount": amount_rupees,
            "deposit": float(payload.get("deposit") or 0),
            "duration_months": int(payload.get("duration_months") or 0) or None,
            "end_date": payload.get("end_date") if order_type == "rent" else None,
            "purchase_date": now_iso if order_type == "buy" else None,
            "payment_id": str(payload.get("razorpay_payment_id", "")).strip(),
            "payment_status": "paid",
            "razorpay_order_id": str(payload.get("razorpay_order_id", "")).strip(),
            "razorpay_signature": str(payload.get("razorpay_signature", "")).strip(),
        }

        try:
            inserted = insert_order_with_fallback(order_row)
        except RuntimeError as persistence_error:
            message = str(persistence_error or "")
            if "row-level security policy" in message.lower():
                return jsonify(
                    {
                        "error": "Order could not be saved due to Supabase RLS. Check backend SUPABASE_SERVICE_ROLE_KEY configuration.",
                    }
                ), 500
            raise

        if order_type == "rent" and inserted:
            rental_row = {
                "id": str(uuid.uuid4()),
                "order_id": order_id_uuid,
                "user_id": buyer_id,
                "guide_id": guide_id,
                "amount": amount_rupees,
                "deposit": float(payload.get("deposit") or 0),
                "duration_months": int(payload.get("duration_months") or 0) or None,
                "start_date": now_iso,
                "end_date": payload.get("end_date"),
                "refund_status": "pending",
            }
            inserted_rental = insert_rental_with_fallback(rental_row)
            try:
                create_wallet_entries_for_rental_order(inserted or order_row, inserted_rental or rental_row)
            except Exception as wallet_error:
                print("Wallet entry warning:", str(wallet_error))

        response = {
            "success": True,
            "message": "Payment verified and order saved.",
            "order": {
                "id": inserted.get("id") if isinstance(inserted, dict) else order_id_uuid,
                "order_key": inserted.get("order_key") if isinstance(inserted, dict) else order_key,
                "guide_id": guide_id,
                "amount": amount_rupees,
                "payment_status": "paid",
                "order_type": order_type,
            },
        }
        return jsonify(response)
    except ValueError as error:
        return jsonify({"error": str(error)}), 400
    except Exception as error:
        error_message = str(error) or "Payment verification failed."
        print("Razorpay verify-payment failed:", error_message)
        return jsonify({"error": error_message}), 500


@app.route("/phone/send-otp", methods=["POST", "OPTIONS"])
@app.route("/api/phone/send-otp", methods=["POST", "OPTIONS"])
def send_phone_otp():
    if request.method == "OPTIONS":
        return ("", 204)

    payload = request.get_json(silent=True) or {}
    user_id = str(payload.get("user_id", "")).strip()
    phone_e164 = normalize_phone_to_e164(payload.get("phone"))

    if not user_id:
        return jsonify({"error": "user_id is required."}), 400

    if not phone_e164:
        return jsonify({"error": "A valid phone number is required."}), 400

    otp_code = f"{secrets.randbelow(900000) + 100000}"
    expires_at = time.time() + 5 * 60
    cache_key = make_phone_otp_key(user_id, phone_e164)

    try:
        send_otp_via_twilio(phone_e164, otp_code)
        if not os.getenv("TWILIO_VERIFY_SERVICE_SID", "").strip():
            PHONE_OTP_STORE[cache_key] = {
                "otp": otp_code,
                "expires_at": expires_at,
                "attempts": 0,
            }
        return jsonify({"success": True, "message": "OTP sent successfully."})
    except Exception as error:
        return jsonify({"error": str(error) or "Failed to send OTP."}), 500


@app.route("/phone/verify-otp", methods=["POST", "OPTIONS"])
@app.route("/api/phone/verify-otp", methods=["POST", "OPTIONS"])
def verify_phone_otp():
    if request.method == "OPTIONS":
        return ("", 204)

    payload = request.get_json(silent=True) or {}
    user_id = str(payload.get("user_id", "")).strip()
    phone_e164 = normalize_phone_to_e164(payload.get("phone"))
    otp = str(payload.get("otp", "")).strip()

    if not user_id:
        return jsonify({"error": "user_id is required."}), 400
    if not phone_e164:
        return jsonify({"error": "A valid phone number is required."}), 400
    if not otp:
        return jsonify({"error": "OTP is required."}), 400

    verify_service_sid = os.getenv("TWILIO_VERIFY_SERVICE_SID", "").strip()

    if verify_service_sid:
        try:
            twilio = get_twilio_config()
            url = f"https://verify.twilio.com/v2/Services/{verify_service_sid}/VerificationCheck"
            response = requests.post(
                url,
                auth=(twilio["account_sid"], twilio["auth_token"]),
                data={
                    "To": phone_e164,
                    "Code": otp,
                },
                timeout=20,
            )

            if response.status_code >= 400:
                try:
                    payload = response.json()
                    msg = payload.get("message") or payload.get("detail") or response.text
                except Exception:
                    msg = response.text
                return jsonify({"error": f"Failed to verify OTP: {msg}"}), 500

            payload = response.json() if response.content else {}
            if str(payload.get("status", "")).lower() != "approved":
                return jsonify({"error": "Invalid OTP."}), 400

            return jsonify({"success": True, "verified": True})
        except Exception as error:
            return jsonify({"error": f"Failed to verify OTP: {error}"}), 500

    cache_key = make_phone_otp_key(user_id, phone_e164)
    entry = PHONE_OTP_STORE.get(cache_key)
    if not entry:
        return jsonify({"error": "OTP not found. Please request a new OTP."}), 400

    if time.time() > float(entry.get("expires_at", 0)):
        PHONE_OTP_STORE.pop(cache_key, None)
        return jsonify({"error": "OTP expired. Please request a new OTP."}), 400

    attempts = int(entry.get("attempts", 0)) + 1
    entry["attempts"] = attempts
    PHONE_OTP_STORE[cache_key] = entry

    if attempts > 5:
        PHONE_OTP_STORE.pop(cache_key, None)
        return jsonify({"error": "Too many invalid attempts. Request a new OTP."}), 400

    if otp != str(entry.get("otp", "")):
        return jsonify({"error": "Invalid OTP."}), 400

    PHONE_OTP_STORE.pop(cache_key, None)
    return jsonify({"success": True, "verified": True})

@app.route("/")
def index():
    return jsonify({"message": "Welcome to the Reguide backend"})

if __name__ == "__main__":
    debug_enabled = os.getenv("FLASK_DEBUG", "false").lower() == "true"
    port = int(os.getenv("PORT", "5000"))
    app.run(host="0.0.0.0", port=port, debug=debug_enabled)
