# SLAVE — เกมไพ่สลาฟ (ออนไลน์ 8-bit)

เกมไพ่สลาฟ 3-8 คนแบบออนไลน์เรียลไทม์ สไตล์ 8-bit ไม่มีฐานข้อมูล (state อยู่ใน memory)

- **กติกาฉบับเต็ม: [docs/RULES.md](docs/RULES.md)**
- คำศัพท์โดเมน: [CONTEXT.md](CONTEXT.md)
- การตัดสินใจเชิงสถาปัตยกรรม: [docs/adr/](docs/adr/)

## Stack

- **packages/engine** — rule engine บริสุทธิ์ (TypeScript) + types + wire protocol ใช้ร่วม client/server
- **apps/server** — Node + Socket.IO authoritative server (เก็บไพ่ทุกคน ส่งให้แต่ละคนเห็นแค่ไพ่ตัวเอง)
- **apps/web** — React + Vite UI สไตล์ 8-bit + chiptune SFX (Web Audio สังเคราะห์เอง ไม่มีไฟล์ asset)

## เริ่มใช้งาน

```bash
npm install        # ติดตั้ง dependency ทุก workspace
npm test           # รัน unit test ของ rule engine (25 เทสต์)
npm run typecheck  # ตรวจ type ทั้งสามแพ็กเกจ
```

### โหมดพัฒนา (server + client พร้อมกัน)

```bash
npm run dev
```

- server: http://localhost:3001
- web (Vite): http://localhost:5173 ← เปิดอันนี้ในเบราว์เซอร์

เปิดหลายแท็บ/อุปกรณ์เพื่อจำลองผู้เล่นหลายคน: คนแรกกด "สร้างห้อง" ได้โค้ด 5 หลัก คนอื่นกรอกโค้ดเข้าห้อง host กดเริ่มเมื่อมี 3-8 คน

### โหมด production (เสิร์ฟ client จาก server เดียว)

```bash
npm run build      # build web → apps/web/dist + bundle server → apps/server/dist/index.js
npm start          # node apps/server/dist/index.js เสิร์ฟทั้ง API และไฟล์ web (อ่าน PORT จาก env)
```

> `npm run build` ใช้ Vite (เว็บ) + esbuild (bundle server เป็น JS) — รัน production ด้วย `node` ล้วน ไม่ต้องใช้ tsx

## Deploy ฟรี (บริการเดียวจบ — ทั้ง API + เว็บ)

ระบบต้องรันเป็น **persistent service + WebSocket** (ไม่ใช่ static/serverless) และเป็น **อินสแตนซ์เดียว** (state อยู่ใน RAM)

**Render (ง่ายสุด):**
1. push repo ขึ้น GitHub
2. Render → New → **Blueprint** → เลือก repo (ใช้ [render.yaml](render.yaml) ที่ให้มา) — หรือ New → Web Service แล้วตั้ง Build = `npm install --include=dev && npm run build`, Start = `npm start`
3. Render ใส่ `PORT` ให้อัตโนมัติ, health check ที่ `/health`

**Docker (Fly.io / Koyeb / ที่อื่น):** มี [Dockerfile](Dockerfile) ให้แล้ว — `docker build -t slave . && docker run -p 3001:3001 slave` หรือ `fly launch` / `fly deploy`

ปรับเวลาต่อเทิร์นได้ผ่าน env `TURN_TIMEOUT_MS` (ดีฟอลต์ 15000)

> ⚠️ ฟรีทเทียร์มัก "หลับ" เมื่อไม่มีคนเล่น → ปลุกครั้งแรกช้า ~30 วิ และเกมที่ค้างอยู่หายตอนหลับ/รีสตาร์ท (state อยู่ใน RAM)

## ทดสอบ end-to-end

```bash
PORT=3010 npx tsx apps/server/src/index.ts &   # หรือ $env:PORT=3010 บน PowerShell
URL=http://localhost:3010 npx tsx scripts/smoke.ts
```

## สรุปกติกา (ดูเต็มใน [docs/RULES.md](docs/RULES.md))

- แจกเท่ากันตัดเศษ; ความใหญ่ `2 > A > K > … > 3`, ดอก `♣ < ♦ < ♥ < ♠`
- Combo = ไพ่ Rank เดียวกัน: เดี่ยว/คู่/ตอง/สี่ใบ (ไม่มีไพ่เรียง) — ลงต้อง **จำนวนเท่าเดิม + Rank สูงกว่า**
- **ตบ:** Triple ข่ม Single, Four ข่ม Pair (ทั้งสองโหมด)
- 3♣ นำ Round 1; Slave นำ Round ถัดไป; **ทิศวนสลับทุก Round**; เวลา 15 วิ/เทิร์น
- ตำแหน่ง: King / Queen(≥4) / People / Vice-Slave(≥5) / Slave; แลก King↔Slave 2, Queen↔รองสุดท้าย 1
- **โหมดใส่นัว:** ลงตอง→คนอื่นจั่ว 1, สี่ใบ→จั่ว 2 (จากกองที่ใช้แล้ว)
- แลกไพ่ President-style; กฎ Regicide โค่น King ที่ป้องกันไม่สำเร็จลงเป็น Slave
- จบ Match ตามจำนวน Round ที่ตั้งไว้ตอนสร้างห้อง คิดแต้มตามตำแหน่ง

## หมายเหตุ

- เซิร์ฟเวอร์เก็บ state ในหน่วยความจำ — รีสตาร์ทเซิร์ฟเวอร์ = เกมที่เล่นอยู่หาย (ดู ADR-0002)
- คนหลุดกลางเกม: ระบบ auto-pass ให้ จองที่นั่งไว้ กลับเข้ามาด้วยโค้ด+ชื่อเดิม (session token ใน localStorage)
