افتح index.html مباشرة في المتصفح.
التنقل: الأنمي ← الحلقات ← الروابط.
استيراد JSON يضيف الأنميات ويستبدل الأنمي المطابق بالاسم. يدعم أيضاً ناتج extract-episodes.js.
تصدير المكتبة ينزل نسخة JSON من بياناتك. الحفظ في المتصفح محلي لهذا الجهاز.
عند التشغيل عبر خادم محلي تُقرأ library.json تلقائياً ما لم توجد مكتبة محفوظة؛ عند الفتح المباشر استخدم زر الاستيراد لقراءة ملف JSON المعدل.
الروابط النموذجية مأخوذة من الموقع، ولم ينجح اختبار تشغيلها في المتصفح السابق.

لإفراغ المكتبة من GitHub، افتح Actions ثم Reset anime library ثم Run workflow. سيُحدّث هذا الإجراء library.json إلى {"anime": []} ويضيف التغيير إلى الفرع الذي تم اختياره.
White library redesign
- Light white interface with indigo accents, responsive cards and clear library totals.
- Library card/list toggle is remembered locally; episodes and server links use compact rows.
- Search is contextual (anime, episode, server/quality). Name sorting uses numeric-aware Arabic collation and preserves original route indices.
- JSON import/export, saved local library, poster fallback and same-tab watch links are retained.
- Verified locally: anime > episodes > server navigation, server search, card/list switching, and 390px mobile layout without horizontal overflow. JavaScript syntax check passed.
