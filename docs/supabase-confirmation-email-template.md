# Confirmation Email Template (Supabase Auth)

Use this template in Supabase so confirmation emails look branded instead of plain text.

## Where to paste it

1. Open Supabase Dashboard.
2. Go to `Authentication` -> `Email Templates`.
3. Select **Confirm signup**.
4. Set a subject, for example: `Confirm your Book&Pay account`.
5. Paste the HTML below in the template body.
6. Save changes.

## HTML template

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Confirm your Book&Pay account</title>
  </head>
  <body style="margin:0;padding:0;background:#050505;font-family:Inter,Segoe UI,Arial,sans-serif;color:#e5e5e5;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#050505;padding:24px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#0b0b0b;border:1px solid #262626;border-radius:16px;overflow:hidden;">
            <tr>
              <td style="padding:28px 28px 10px 28px;">
                <p style="margin:0 0 8px 0;font-size:13px;letter-spacing:0.08em;text-transform:uppercase;color:#a3a3a3;">Book&Pay</p>
                <h1 style="margin:0;font-size:24px;line-height:1.3;color:#fafafa;">Confirm your email</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:10px 28px 0 28px;">
                <p style="margin:0;font-size:15px;line-height:1.7;color:#d4d4d4;">
                  Hi,
                </p>
                <p style="margin:12px 0 0 0;font-size:15px;line-height:1.7;color:#d4d4d4;">
                  Please confirm your email address for
                  <strong style="color:#ffffff;">{{ .Email }}</strong>
                  to finish creating your account.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 28px 10px 28px;">
                <a
                  href="{{ .ConfirmationURL }}"
                  style="display:inline-block;background:#fafafa;color:#0a0a0a;text-decoration:none;font-weight:600;font-size:14px;padding:12px 18px;border-radius:10px;"
                >
                  Confirm account
                </a>
              </td>
            </tr>
            <tr>
              <td style="padding:10px 28px 0 28px;">
                <p style="margin:0;font-size:13px;line-height:1.6;color:#a3a3a3;">
                  If the button does not work, copy and paste this URL in your browser:
                </p>
                <p style="margin:8px 0 0 0;word-break:break-all;font-size:12px;line-height:1.6;color:#93c5fd;">
                  {{ .ConfirmationURL }}
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:22px 28px 26px 28px;">
                <p style="margin:0;font-size:12px;line-height:1.7;color:#737373;">
                  If you did not create an account, you can ignore this email.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
```

## Notes

- This project now sends `emailRedirectTo` to `FRONTEND_URL/auth/callback` during sign-up, so the button returns users to the app correctly.
- Supabase handles the final email rendering/sending for confirmation emails. That is why the template is configured in Supabase Dashboard.
