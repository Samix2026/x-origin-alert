<div dir="rtl">

# منبه موقع الحساب في اكس

إضافة لمتصفح كروم تضع علامة تحذير بجانب اسم الحساب في منصة اكس، دون الحاجة لفتح البروفايل، إذا كان موقع الحساب في خانة **Account based in** واحدا من:

- **West Asia**
- **North Africa**
- أو ظهر على الحساب **مؤشر VPN** من اكس

الهدف: مساعدة المستخدم على الانتباه للحسابات التي قد تنتحل هوية غير هويتها لنشر الفتنة وإثارة المشاكل بين الشعوب، قبل أن يتفاعل معها.

## مهم: العلامة مؤشر وليست حكما

- البيانات مصدرها اكس نفسها، من صفحة About this account.
- اكس تسمح لأي مستخدم بعرض المنطقة بدل الدولة لأسباب الخصوصية، فقد تظهر العلامة على حسابات سليمة.
- مؤشر VPN قد يظهر على مستخدمين لا يستخدمون VPN أصلا، حسب طريقة اكس في الرصد.

تحقق دائما قبل الحكم على أي حساب.

## التثبيت

### الطريقة الأولى: من متجر كروم (ننصح بها)

1. افتح [صفحة الإضافة في متجر كروم](https://chromewebstore.google.com/detail/glekbdcdgghjbhehbdcojikcefjieikl)
2. اضغط **Add to Chrome**
3. افتح اكس وتصفح كالمعتاد

التحديثات تصلك تلقائيا من المتجر.

### الطريقة الثانية: يدويا من GitHub (للمطورين)

1. حمل ملف **Source code (zip)** من [صفحة النسخ Releases](https://github.com/Samix2026/x-origin-alert/releases/latest)، وفك الضغط
2. افتح في كروم الرابط `chrome://extensions`
3. فعل **Developer mode** أعلى الصفحة
4. اضغط **Load unpacked** واختر المجلد الذي فككته

للتحديث: حمل النسخة الجديدة، وضع ملفاتها مكان القديمة في نفس المجلد، ثم اضغط زر التحديث على الإضافة في صفحة `chrome://extensions`.

ملاحظة: نسخة المتجر قد تتأخر أياما عن آخر نسخة هنا، بسبب مدة مراجعة قوقل.

## الإعدادات

من أيقونة الإضافة في شريط كروم يمكنك:

- تشغيل الإضافة أو إيقافها
- تشغيل تحذير VPN أو إيقافه
- تعديل قائمة المناطق التي يظهر عندها التحذير
- رؤية عدد الحسابات المفحوصة وعدد التحذيرات
- مسح الذاكرة المؤقتة

## الخصوصية

- الإضافة تعمل بالكامل داخل متصفحك وبجلستك في اكس.
- لا ترسل أي بيانات لأي خادم خارج x.com.
- لا تجمع ولا تحفظ بيانات دخولك.
- النتائج تحفظ محليا في متصفحك فقط لمدة 14 يوما لتقليل الطلبات.

## كيف تتجنب تقييد حسابك

الإضافة تفحص فقط الحسابات الظاهرة على الشاشة، بمعدل طلب واحد كل 2.5 ثانية، وتتوقف تلقائيا إذا أوقفت اكس الطلبات مؤقتا ثم تكمل لاحقا.

## إذا توقفت عن العمل

اكس تغير بنية صفحاتها أحيانا. إذا توقفت الإضافة:

1. افتح صفحة About لأي حساب مرة واحدة، فالإضافة تلتقط المعرف الجديد تلقائيا.
2. إن لم ينفع ذلك، افتح Issue في هذا المستودع.

## الترخيص

MIT

---

إعداد: سامي المحيميد [@SamiBizConsult](https://x.com/SamiBizConsult)

</div>

---

## English

Chrome extension that shows a warning badge next to X (Twitter) usernames when the account's **Account based in** is *West Asia* or *North Africa*, or when X shows a VPN/proxy indicator. Runs entirely in your browser using your own X session; no data leaves x.com. The badge is a signal, not a verdict. Install from the [Chrome Web Store](https://chromewebstore.google.com/detail/glekbdcdgghjbhehbdcojikcefjieikl), or manually via `chrome://extensions` → Developer mode → Load unpacked. MIT licensed.
