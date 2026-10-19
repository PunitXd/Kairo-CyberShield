// Placeholder so the Compose stack starts before the Defender exists.
// Replaced by the real boot sequence in Oct 19 task 5.
console.log(JSON.stringify({ time: new Date().toISOString(), level: 'info', svc: 'defender', msg: 'placeholder: defender not built yet' }));
setInterval(() => {}, 1 << 30);
