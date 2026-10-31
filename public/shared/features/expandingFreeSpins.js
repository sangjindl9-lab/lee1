// Client presentation for the server's 'expandingFreeSpins' feature.
window.SlotFeatures = window.SlotFeatures || {};
window.SlotFeatures.expandingFreeSpins = {
  describe(f, cfg) {
    const sc = cfg.symbols.find((s) => s.scatter);
    return `<h3>무료 회전과 확장 심볼</h3>${sc ? sc.name : '스캐터'} ${f.minScatters}개 이상이면 무료 회전 ${f.spins}회가 시작됩니다. 시작할 때 확장 심볼 하나가 정해지고, 무료 회전 중 그 심볼이 당첨에 필요한 수의 릴에 나타나면 해당 릴 전체로 확장되어 인접 여부와 관계없이 모든 라인에 지급됩니다. 무료 회전 중 ${f.minScatters}개 이상이 다시 나오면 ${f.retrigger}회가 추가됩니다.`;
  },
  async run(shell, F, bet) {
    const { Audio, FX, sleep, cfg, symHTML } = shell, $ = (id) => document.getElementById(id);
    shell.markSpecial(); Audio.gong(.5); await sleep(1300);

    // Intro: the scroll unrolls and picks the expanding symbol
    Audio.gong(.7); Audio.drum(0, 1); Audio.drum(.25, .8); FX.burst(FX.W / 2, FX.H / 2, 90, 'accent', 1.3, shell.theme.accentHue || 155);
    const ov = $('ovFree'), pick = $('pick'), go = $('freeGo');
    ov.hidden = false; go.hidden = true; $('freeName').textContent = ''; pick.classList.remove('final');
    $('freeTitle').textContent = `무료 회전 ${F.awarded}회`; $('freeSub').textContent = '확장 심볼을 고르는 중';
    await sleep(900);
    const pool = cfg.symbols.map((s, i) => i).filter((i) => !cfg.symbols[i].scatter);
    let delay = 50;
    for (let i = 0; i < 26; i++) { pick.innerHTML = symHTML(pool[(i * 4 + Math.floor(Math.random() * 3)) % pool.length]); Audio.shuffle(); await sleep(delay); delay *= 1.1; }
    pick.innerHTML = symHTML(F.expandSym); pick.classList.add('final'); Audio.fanfare(); FX.burst(FX.W / 2, FX.H / 2, 50);
    $('freeName').textContent = `확장 심볼 · ${cfg.symbols[F.expandSym].name}`;
    await shell.waitButton(go, 1800); ov.hidden = true;

    shell.setFeature(true); shell.setWinLabel('무료 회전 당첨');
    let left = F.awarded, idx = 0, total = 0;
    for (const sp of F.spins) {
      left--; idx++;
      shell.setMode(`무료 회전 <b>${idx}</b> · 남은 회전 <b>${left}</b> · 확장 심볼 ${cfg.symbols[F.expandSym].name}`);
      await sleep(shell.turbo ? 150 : 450);
      shell.setGrid(sp.grid); Audio.drum(0, .5);
      await shell.spinReels(sp.grid);
      const ex = sp.expand;
      const w = await shell.present(sp, bet, {
        label: ex ? '확장 당첨' : '당첨',
        after: ex ? async () => {
          await sleep(shell.turbo ? 150 : 350); shell.softClear(); Audio.sweep();
          const step = shell.turbo ? 90 : 200;
          ex.reels.forEach((r, k) => setTimeout(() => {
            const d = document.createElement('div'); d.className = 'expand'; d.innerHTML = symHTML(ex.sym); shell.reels[r].el.appendChild(d);
            const b = shell.reels[r].el.getBoundingClientRect(); FX.burst(b.left + b.width / 2, b.top + b.height / 2, 30); Audio.drum(0, .7);
          }, k * step));
          await sleep(ex.reels.length * step + 400);
          shell.shake(); Audio.fanfare(); shell.showWinbar('확장 당첨', sp.win * bet);
        } : null,
      });
      total += w;
      if (sp.retrigger) { left += sp.retrigger; Audio.fanfare(); FX.burst(FX.W / 2, FX.H / 2, 70, 'accent', 1.2, shell.theme.accentHue || 155); shell.toast(`무료 회전 ${sp.retrigger}회 추가!`); await sleep(1200); }
      await sleep(w > 0 ? (shell.turbo ? 500 : 1300) : (shell.turbo ? 150 : 350));
    }
    shell.setFeature(false); shell.setMode('');
    const end = $('ovEnd'); $('endAmt').textContent = shell.fmt(0); end.hidden = false; Audio.gong(.6);
    await shell.countUp($('endAmt'), 0, total, Math.min(2500, 500 + total / bet * 15)); FX.burst(FX.W / 2, FX.H / 2, 60, 'coin');
    await shell.waitButton($('endGo'), 2200); end.hidden = true;
    return total;
  },
};
