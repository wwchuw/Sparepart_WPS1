// ตั้งค่าแอป แก้ไฟล์นี้ไฟล์เดียวพอ
window.APP_CONFIG = {
  // URL ของ Web app จาก Apps Script (Deploy → Web app) ลงท้ายด้วย /exec
  apiUrl: "https://script.google.com/macros/s/AKfycbxsqXqdPicIUot18ze9vCmm_I6vMgh_XltxvvPqmvLXvmiBZmuWpRquF6kS28Q64K5V/exec",
  appName: "อะไหล่ WPS1",
  // สถานะใบเบิกในชีท → คำที่แสดงในแอป
  statusLabel: { Draft: "ร่าง", Approved: "อนุมัติแล้ว" },
  // ชื่อเรียกกลุ่มตำแหน่ง ถ้าคอลัมน์ Rack เป็นตัวเลข
  rackPrefix: "ชั้นวาง ",
  docPrefix: "SR"
};
