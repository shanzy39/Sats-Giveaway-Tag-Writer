# Sats Giveaway Tag Writer

Write Lightning **LNURL-withdraw** links to NFC tags for sats giveaways — get a scannable **QR** and a **Flipper Zero `.nfc`** file from any withdraw link. Single-file, 100% client-side, works offline.

### ▶️ Live tool: https://shanzy39.github.io/Sats-Giveaway-Tag-Writer/

---

## What it does

Paste an `LNURL1…` withdraw link and the tool will:

- **Validate** it (bech32 decode) and show the **decoded target URL** so you can confirm it's really your link
- Render a **QR code** (print / phone fallback) — generated locally, no external libraries
- Export a **Flipper `.nfc` file** (NDEF URI record) you can write to a blank NTAG21x tag
- Show a **live byte meter** with a tag-type selector so you know a link fits *before* you go to the Flipper

## How the sats actually work

**The sats never live on the chip.** The tag only holds a *claim link*. The funds sit in a Lightning wallet you control; when someone taps the tag, their wallet pulls the sats out over Lightning.

Typical flow:

1. Stand up a backend that issues withdraw links (e.g. a self-hosted [LNbits](https://lnbits.com) → **Withdraw Links** extension). Self-hosting is free.
2. Fund that wallet.
3. Create a **single-use** withdraw link for the giveaway amount → you get an `LNURL1…` string.
4. Paste it into this tool → download the `.nfc` → write it to a tag with your Flipper.
5. Recipient taps the tag (or scans the QR) → sats land in their wallet.

This tool only does **step 4** — encoding. It never touches your wallet or moves funds.

## Tag compatibility

| Tag | User memory | Fits a typical LNURL? |
|-----|-------------|------------------------|
| NTAG213 | 144 bytes | Sometimes (short links only) |
| NTAG215 | 504 bytes | Yes |
| NTAG216 | 888 bytes | Yes, always |

The byte meter turns red and disables export if a link won't fit the selected tag.

## ⚠️ Treat tags like cash

An LNURL-withdraw link is a **bearer** claim — anyone who taps or scans it can withdraw the sats. Always:

- Use a **single-use** withdraw config so a tag can't be drained twice.
- **Test each tag** with a small throwaway amount before a real giveaway — wallet support for LNURL-withdraw-over-NFC varies.
- Treat a loaded tag like cash; if it's lost, the sats can be claimed by whoever finds it.

## Privacy

Everything runs in your browser. The link you paste is never sent anywhere — no servers, no tracking, no analytics.

## License

MIT
