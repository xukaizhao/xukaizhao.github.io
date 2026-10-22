(() => {
  'use strict';
  const $ = (selector, parent = document) => parent.querySelector(selector);
  const $$ = (selector, parent = document) => [...parent.querySelectorAll(selector)];
  document.documentElement.classList.add('js');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const year = $('#year');
  if (year) year.textContent = String(new Date().getFullYear());

  const navToggle = $('.nav-toggle');
  const nav = $('.nav');
  function closeMenu(restoreFocus = false) {
    nav.classList.remove('open');
    navToggle.setAttribute('aria-expanded', 'false');
    navToggle.setAttribute('aria-label', 'Open menu');
    if (restoreFocus) navToggle.focus();
  }
  navToggle.addEventListener('click', () => {
    const open = !nav.classList.contains('open');
    nav.classList.toggle('open', open);
    navToggle.setAttribute('aria-expanded', String(open));
    navToggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
  });
  $$('a', nav).forEach(link => link.addEventListener('click', () => closeMenu()));
  document.addEventListener('click', event => {
    if (!nav.contains(event.target) && !navToggle.contains(event.target)) closeMenu();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && nav.classList.contains('open')) closeMenu(true);
  });
  window.matchMedia('(min-width: 1001px)').addEventListener('change', event => {
    if (event.matches) closeMenu();
  });

  // Short, once-only reveal. No motion is required to access any content.
  const revealElements = $$('.reveal');
  if ('IntersectionObserver' in window && !reduceMotion.matches) {
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.remove('reveal-pending');
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.04 });
    revealElements.forEach(element => {
      element.classList.add('reveal-pending');
      observer.observe(element);
    });
    reduceMotion.addEventListener('change', event => {
      if (event.matches) {
        observer.disconnect();
        revealElements.forEach(element => element.classList.remove('reveal-pending'));
      }
    });
  }

  // Keep the original publication grid and all cards visible by default.
  const chips = $$('.chip[data-filter]');
  const cards = $$('.paper-card');
  const search = $('#pubSearch');
  const count = $('#pubCount');
  const empty = $('#publicationEmpty');
  const singleColumnPapers = window.matchMedia('(max-width: 760px)');
  const automaticDetailStates = new WeakMap();

  function setDetailOpen(detail, open) {
    if (detail.open === open) return;
    automaticDetailStates.set(detail, open);
    detail.open = open;
  }

  // Pair the cards currently sharing a visible grid row, including filtered results.
  function syncExpandedRows() {
    if (singleColumnPapers.matches) return;
    const visibleCards = cards.filter(card => !card.hidden);
    for (let i = 0; i + 1 < visibleCards.length; i += 2) {
      const left = $('.paper-details', visibleCards[i]);
      const right = $('.paper-details', visibleCards[i + 1]);
      const open = left.open || right.open;
      setDetailOpen(left, open);
      setDetailOpen(right, open);
    }
  }

  cards.forEach(card => {
    const detail = $('.paper-details', card);
    detail.addEventListener('toggle', () => {
      const automatic = automaticDetailStates.has(detail) &&
        automaticDetailStates.get(detail) === detail.open;
      automaticDetailStates.delete(detail);
      if (automatic || card.hidden || singleColumnPapers.matches) return;
      const visibleCards = cards.filter(item => !item.hidden);
      const position = visibleCards.indexOf(card);
      const partner = visibleCards[position % 2 === 0 ? position + 1 : position - 1];
      if (partner) setDetailOpen($('.paper-details', partner), detail.open);
    });
  });
  singleColumnPapers.addEventListener('change', syncExpandedRows);

  const normalize = value => String(value || '').normalize('NFKC').toLowerCase().trim();
  const index = new Map(cards.map(card => [card, normalize(`${card.dataset.search || ''} ${card.textContent}`)]));
  let activeFilter = 'All';
  function filterPapers(revealResults = false) {
    const terms = normalize(search.value).split(/\s+/).filter(Boolean);
    let visible = 0;
    cards.forEach(card => {
      const show = (activeFilter === 'All' || card.dataset.category === activeFilter) &&
        terms.every(term => index.get(card).includes(term));
      card.hidden = !show;
      // Filtering should never leave revealed results stuck transparent.
      if (show && revealResults) card.classList.remove('reveal-pending');
      visible += Number(show);
    });
    count.textContent = String(visible);
    empty.hidden = visible !== 0;
    syncExpandedRows();
  }
  chips.forEach(chip => chip.addEventListener('click', () => {
    activeFilter = chip.dataset.filter;
    chips.forEach(button => {
      const active = button === chip;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    filterPapers(true);
  }));
  search.addEventListener('input', () => filterPapers(true));
  $('#resetPublications').addEventListener('click', () => {
    search.value = '';
    chips.find(chip => chip.dataset.filter === 'All').click();
    search.focus();
  });
  filterPapers();

  // Honor panels keep a stable viewport and support year filtering and scrolling.
  $$('.timeline-years').forEach(controls => {
    const list = document.getElementById(controls.dataset.timeline);
    const items = $$('.timeline-item', list);
    const hint = $('.timeline-hint', list.parentElement);
    $$('[data-timeline-year]', controls).forEach(button => button.addEventListener('click', () => {
      const selectedYear = button.dataset.timelineYear;
      let visible = 0;
      items.forEach(item => {
        const show = selectedYear === 'all' ||
          (selectedYear === 'earlier' ? Number(item.dataset.year) < 2025 : item.dataset.year === selectedYear);
        item.hidden = !show;
        visible += Number(show);
      });
      $$('[data-timeline-year]', controls).forEach(item => {
        const active = item === button;
        item.classList.toggle('active', active);
        item.setAttribute('aria-pressed', String(active));
      });
      list.scrollTop = 0;
      hint.textContent = 'Scroll to browse';
    }));
  });

  // Original horizontal image strips, with optional arrows and touch scrolling.
  const strips = ['reviewerList', 'competitionList'].map(id => document.getElementById(id));
  function updateStrip(strip) {
    const buttons = $$(`[data-scroll-target="${strip.id}"]`);
    buttons.forEach(button => {
      const previous = button.dataset.direction === '-1';
      button.disabled = previous ? strip.scrollLeft <= 2 :
        strip.scrollLeft >= strip.scrollWidth - strip.clientWidth - 2;
    });
  }
  strips.forEach(strip => {
    $$(`[data-scroll-target="${strip.id}"]`).forEach(button => button.addEventListener('click', () => {
      strip.scrollBy({ left: Number(button.dataset.direction) * Math.max(220, strip.clientWidth * .7),
        behavior: reduceMotion.matches ? 'auto' : 'smooth' });
    }));
    strip.addEventListener('scroll', () => updateStrip(strip), { passive: true });
    if ('ResizeObserver' in window) new ResizeObserver(() => updateStrip(strip)).observe(strip);
    updateStrip(strip);
  });
  window.addEventListener('resize', () => strips.forEach(updateStrip));

  // Preserve the original copy-link button with truthful success/failure feedback.
  async function copyText(value) {
    if (navigator.clipboard && window.isSecureContext) {
      try { await navigator.clipboard.writeText(value); return true; } catch (_) { /* Use selectable fallback. */ }
    }
    const field = document.createElement('textarea');
    field.value = value;
    field.setAttribute('readonly', '');
    field.style.cssText = 'position:fixed;left:-9999px;top:0';
    document.body.appendChild(field);
    field.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (_) { /* Report failure. */ }
    field.remove();
    return ok;
  }
  $$('[data-copy], [data-copy-path]').forEach(button => {
    const original = button.textContent;
    let timer;
    button.addEventListener('click', async () => {
      clearTimeout(timer);
      const value = button.dataset.copyPath ? new URL(button.dataset.copyPath, document.baseURI).href : button.dataset.copy;
      const ok = await copyText(value);
      button.textContent = ok ? 'Copied' : 'Could not copy';
      button.classList.toggle('copied', ok);
      button.focus({ preventScroll: true });
      timer = setTimeout(() => {
        button.textContent = original;
        button.classList.remove('copied');
      }, 1800);
    });
  });
})();
