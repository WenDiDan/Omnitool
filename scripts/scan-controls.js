// 盘点首页/工具页的手写控件分布
const fs = require('fs');

[['pages/home/home', '首页'], ['pages/tool/tool', '工具页']].forEach(([base, label]) => {
  console.log('======== ' + label + ' ========');

  const js = fs.readFileSync(base + '.js', 'utf8').split('\n');
  let toasts = 0, modals = 0;
  js.forEach((l, i) => {
    if (/wx\.showToast/.test(l)) toasts++;
    if (/wx\.showModal/.test(l)) modals++;
  });
  console.log('wx.showToast:', toasts, '处 | wx.showModal:', modals, '处');

  const wxml = fs.readFileSync(base + '.wxml', 'utf8').split('\n');
  wxml.forEach((l, i) => {
    if (/class="[^"]*(btn|button|modal|dialog|confirm|popup)[^"]*"/.test(l) && !l.includes('wx:')) {
      console.log((i + 1) + ': ' + l.trim().slice(0, 100));
    }
  });
});
