import { useState } from 'react';

const NORMAL: string[] = [
  '🎯 เป้าหมาย: ลงไพ่ในมือให้หมดก่อน = ได้เป็น King (ราชา)',
  '🔢 ความใหญ่: 2 > A > K > Q > J > 10 > … > 3 (เลข 2 ใหญ่สุด)',
  '♠ ดอก: ♠ > ♥ > ♦ > ♣ (ใช้ตัดสินเมื่อแต้มเท่ากัน)',
  '🃏 ลงได้เฉพาะไพ่เลขเดียวกัน: เดี่ยว / คู่ / ตอง / สี่ใบ',
  '⬆️ ลงสู้: ต้องจำนวนใบเท่าเดิม + แต้มสูงกว่า (เดี่ยวสู้เดี่ยว, คู่สู้คู่ …)',
  '💥 ตบ: ตอง ทับ เดี่ยว ได้ · สี่ใบ ทับ คู่ ได้',
  '🥇 ใครมี 3♣ ได้ลงก่อนในตาแรก',
  '🙅 สู้ไม่ได้/ไม่อยากสู้ ก็ "ผ่าน" — ถ้าทุกคนผ่าน คนที่ลงล่าสุดได้เริ่มกองใหม่',
  '🔄 ทิศการวนสลับทุกตา · ⏱ มีเวลา 15 วิ/เทิร์น (ไม่ลง = ผ่านอัตโนมัติ)',
  '👑 จบตา: คนหมดไพ่ก่อน = King → Queen → … → คนสุดท้าย = Slave',
  '🔁 ตาถัดไป: Slave ลงก่อน + Slave ส่งไพ่ดีสุดให้ King (Queen↔รองสุดท้าย เช่นกัน)',
  '⚔️ King ต้องหมดไพ่ก่อนอีกครั้งเพื่อรักษาตำแหน่ง ไม่งั้นตกเป็น Slave',
];

const SAINUA: string[] = [
  '✅ กติกาเหมือนโหมดปกติทุกอย่าง',
  '➕ เพิ่มกฎ "ลงตบไพ่": ลงไพ่ชุดใหญ่ = ป่วนชาวบ้าน',
  '🔥 ลง ตอง (3 ใบ) → ผู้เล่นทุกคน (ยกเว้นคนลง) จั่ว 1 ใบ',
  '💣 ลง สี่ใบ (4 ใบ) → ผู้เล่นทุกคน (ยกเว้นคนลง) จั่ว 2 ใบ',
  '🎴 จั่วจากกองไพ่ที่ลงไปแล้ว (สุ่ม) — ยิ่งลงชุดใหญ่ คนอื่นยิ่งไพ่บาน!',
];

export function RulesModal({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<'normal' | 'sainua'>('normal');
  const items = tab === 'normal' ? NORMAL : SAINUA;
  return (
    <div className="overlay" onClick={onClose}>
      <div className="panel modal rules-modal" onClick={(e) => e.stopPropagation()}>
        <div className="row spread">
          <h2>📖 วิธีเล่น</h2>
          <button className="btn ghost" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="row" style={{ marginBottom: 12 }}>
          <button
            className={`btn ${tab === 'normal' ? 'primary' : 'ghost'}`}
            onClick={() => setTab('normal')}
          >
            ♠ ปกติ
          </button>
          <button
            className={`btn ${tab === 'sainua' ? 'primary' : 'ghost'}`}
            onClick={() => setTab('sainua')}
          >
            🌶️ ใส่นัว
          </button>
        </div>
        <ul className="rules-list">
          {items.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
