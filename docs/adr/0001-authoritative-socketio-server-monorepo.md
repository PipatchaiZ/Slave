# 1. Authoritative realtime server ด้วย Socket.IO + monorepo shared rule engine

วันที่: 2026-05-29

## สถานะ

Accepted

## บริบท

Slave เป็นเกมไพ่ออนไลน์หลายคน (3-8 คน) ที่มี **ไพ่ซ่อน** (ไพ่ในมือของผู้เล่นต้องไม่หลุดให้คนอื่นเห็น) และมีกติกาเทียบไพ่ที่ซับซ้อน (Ladder คี่/คู่, Regicide, การแลกไพ่ข้าม Round) จึงต้องกันการโกงและตัดสินกติกาให้ถูกต้องตรงกันทุกเครื่อง

ทางเลือกที่พิจารณา:

- **Socket.IO + React/Vite + shared TS rule engine (monorepo)** — server ถือ state จริง, มี rooms + auto-reconnect ในตัว, แยก rule engine เป็น package กลางใช้ร่วมทั้ง client/server
- **Colyseus** — framework multiplayer ที่มี room/state-sync สำเร็จรูป ลด boilerplate แต่เพิ่ม abstraction และ state-sync แบบ continuous ที่เกมเทิร์นเบสไม่ต้องใช้
- **raw `ws` + vanilla TS** — dependency น้อยสุด แต่ต้องเขียน protocol/room/reconnect เองทั้งหมด

## การตัดสินใจ

ใช้ **Node.js + TypeScript + Socket.IO** เป็น authoritative server, **React + Vite + TypeScript** เป็น client, และจัด repo เป็น **monorepo** (npm workspaces) ที่มี package กลาง (`packages/engine`) เก็บ types + กติกาทั้งหมด ใช้ร่วมกันทั้งสองฝั่ง

- เซิร์ฟเวอร์เป็นแหล่งความจริงเดียว ถือสำรับและ Hand ของทุกคน ส่งให้แต่ละ client เห็นเฉพาะไพ่ของตัวเอง + ข้อมูลสาธารณะ (จำนวนไพ่คนอื่น, กองบนโต๊ะ)
- client ส่งเฉพาะ "เจตนา" (จะลงไพ่ใบไหน / pass) เซิร์ฟเวอร์ตรวจสอบกับ rule engine แล้ว broadcast state ใหม่
- rule engine เป็น pure function ไม่มี I/O เพื่อให้ทดสอบกติกาได้ง่ายและรันได้ทั้งสองฝั่ง (client ใช้ทำ optimistic validation/ปุ่ม disable)

## ผลที่ตามมา

- **ดี:** กันโกงได้จริง (ไพ่ซ่อนปลอดภัย), กติกาตัดสินจากที่เดียว, rule engine ทดสอบด้วย unit test ได้โดยไม่ต้องมี network, ทีมส่วนใหญ่คุ้น Socket.IO หาตัวอย่างง่าย
- **เสีย:** ต้องดูแล protocol event เอง (มากกว่า Colyseus), ต้องระวัง serialize state ให้ client เห็นเฉพาะส่วนที่ควรเห็น
- ถ้าภายหลังต้องการ state-sync ความถี่สูงหรือ scale หลายเซิร์ฟเวอร์ อาจต้องทบทวนเทียบกับ Colyseus + adapter (เช่น Redis) อีกครั้ง
