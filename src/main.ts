const canvas = document.getElementById('game') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;
ctx.fillStyle = '#07080a';
ctx.fillRect(0, 0, canvas.width, canvas.height);
ctx.fillStyle = '#9aa4ad';
ctx.font = '16px monospace';
ctx.fillText('BLAME! SIM — bootstrap OK', 40, 60);
