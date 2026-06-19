// =============================================================
//  ui-utils.js — Shared UI helpers (modal, toast, navigation)
// =============================================================

// Navigation callbacks — set by main.js
let _navigateFn        = null;
let _goBackFn          = null;
let _navigateReplaceFn = null;
export function setNavigateFn(fn)        { _navigateFn        = fn; }
export function setGoBackFn(fn)          { _goBackFn          = fn; }
export function setNavigateReplaceFn(fn) { _navigateReplaceFn = fn; }
export function navigate(view, id)        { if (_navigateFn)        _navigateFn(view, id); }
export function goBack()                  { if (_goBackFn)          _goBackFn(); }
export function navigateReplace(view, id) { if (_navigateReplaceFn) _navigateReplaceFn(view, id); }

// =============================================
//  Loading state
// =============================================
export function setLoading(container, on) {
    // We don't show a spinner inside the container — content replaces it instantly.
    // This function is a hook for future enhancement.
}

// =============================================
//  Modal
// =============================================
export function showModal(title, bodyHTML) {
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-body').innerHTML    = bodyHTML;
    document.getElementById('modal-overlay').classList.add('open');
    // Always start at the top of the form so the first field is visible
    const modal = document.getElementById('modal');
    if (modal) modal.scrollTop = 0;
}

export function hideModal() {
    document.getElementById('modal-overlay').classList.remove('open');
    document.getElementById('modal-body').innerHTML = '';
}

// =============================================
//  Toast notifications
// =============================================
// =============================================
//  Photo Carousel
//  Call after the carousel HTML is in the DOM.
//  Finds the first .photo-carousel inside `container`.
// =============================================
export function initPhotoCarousel(container) {
    const carousel = container.querySelector('.photo-carousel');
    if (!carousel) return;

    const track   = carousel.querySelector('.photo-carousel-track');
    const slides  = Array.from(carousel.querySelectorAll('.photo-carousel-slide'));
    const prevBtn = carousel.querySelector('.photo-carousel-btn.prev');
    const nextBtn = carousel.querySelector('.photo-carousel-btn.next');
    const counter = carousel.querySelector('.photo-carousel-counter');

    if (!track || !slides.length) return;

    let current = 0;

    function goTo(idx) {
        current = Math.max(0, Math.min(idx, slides.length - 1));
        track.style.transform = `translateX(-${current * 100}%)`;
        if (counter) counter.textContent = `${current + 1} / ${slides.length}`;
        if (prevBtn) prevBtn.style.visibility = current === 0          ? 'hidden' : 'visible';
        if (nextBtn) nextBtn.style.visibility = current === slides.length - 1 ? 'hidden' : 'visible';
    }

    prevBtn?.addEventListener('click', e => { e.stopPropagation(); goTo(current - 1); });
    nextBtn?.addEventListener('click', e => { e.stopPropagation(); goTo(current + 1); });

    // Touch swipe
    let touchStartX = null;
    track.addEventListener('touchstart', e => { touchStartX = e.touches[0].clientX; }, { passive: true });
    track.addEventListener('touchend',   e => {
        if (touchStartX === null) return;
        const dx = touchStartX - e.changedTouches[0].clientX;
        if (Math.abs(dx) > 40) goTo(current + (dx > 0 ? 1 : -1));
        touchStartX = null;
    }, { passive: true });

    goTo(0);
}

export function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast     = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

// =============================================
//  Photo drag-to-reorder
//  Call initPhotoDragSort(gridEl, onOrderChange) after the grid is in the DOM.
//  Works with pointer events (mouse + touch). Each .photo-thumb must have
//  a data-id attribute. onOrderChange receives the new ordered array of IDs.
// =============================================
export function initPhotoDragSort(gridEl, onOrderChange) {
    let dragEl   = null;   // source .photo-thumb
    let ghostEl  = null;   // floating clone that follows the pointer
    let overEl   = null;   // current drop-target thumb
    let originX  = 0, originY  = 0;
    let origRect = null;
    let active   = false;
    const THRESHOLD = 8;   // px of movement before drag activates

    gridEl.addEventListener('pointerdown', e => {
        const thumb = e.target.closest('.photo-thumb[data-id]');
        if (!thumb || e.target.closest('.photo-delete')) return;
        dragEl  = thumb;
        originX = e.clientX;
        originY = e.clientY;
        active  = false;
        dragEl.setPointerCapture(e.pointerId);
        e.preventDefault();
    });

    gridEl.addEventListener('pointermove', e => {
        if (!dragEl) return;
        const dx = e.clientX - originX;
        const dy = e.clientY - originY;

        if (!active) {
            if (Math.hypot(dx, dy) < THRESHOLD) return;
            active   = true;
            origRect = dragEl.getBoundingClientRect();

            // Floating ghost clone
            ghostEl = dragEl.cloneNode(true);
            Object.assign(ghostEl.style, {
                position:      'fixed',
                left:          origRect.left   + 'px',
                top:           origRect.top    + 'px',
                width:         origRect.width  + 'px',
                height:        origRect.height + 'px',
                margin:        '0',
                zIndex:        '9999',
                pointerEvents: 'none',
                borderRadius:  'var(--radius-sm)',
                boxShadow:     '0 8px 28px rgba(0,0,0,0.28)',
                transform:     'scale(1.07)',
                opacity:       '0.92',
                transition:    'none',
            });
            document.body.appendChild(ghostEl);
            dragEl.classList.add('photo-dragging');
        }

        // Reposition ghost
        ghostEl.style.left = (origRect.left + dx) + 'px';
        ghostEl.style.top  = (origRect.top  + dy) + 'px';

        // Find the thumb under the pointer (hide ghost so it doesn't block hit-testing)
        ghostEl.style.display = 'none';
        const el = document.elementFromPoint(e.clientX, e.clientY);
        ghostEl.style.display = '';

        const newOver = el?.closest('.photo-thumb[data-id]');
        if (newOver !== overEl) {
            overEl?.classList.remove('photo-drag-over');
            overEl = (newOver && newOver !== dragEl) ? newOver : null;
            overEl?.classList.add('photo-drag-over');
        }
    });

    function finish() {
        if (!dragEl) return;

        if (active && overEl && overEl !== dragEl) {
            const thumbs = [...gridEl.querySelectorAll('.photo-thumb[data-id]')];
            const si = thumbs.indexOf(dragEl);
            const di = thumbs.indexOf(overEl);
            if (si !== -1 && di !== -1) {
                si < di ? overEl.after(dragEl) : overEl.before(dragEl);
                onOrderChange(
                    [...gridEl.querySelectorAll('.photo-thumb[data-id]')].map(el => el.dataset.id)
                );
            }
        }

        dragEl.classList.remove('photo-dragging');
        overEl?.classList.remove('photo-drag-over');
        ghostEl?.remove();
        ghostEl = null;
        overEl  = null;
        dragEl  = null;
        active  = false;
    }

    gridEl.addEventListener('pointerup',     finish);
    gridEl.addEventListener('pointercancel', finish);
}

// =============================================
//  Date Picker component
//  Renders a text input with auto-hyphen formatting + a calendar button.
//  Call initDatePickers(container) after the HTML is in the DOM.
// =============================================
export function datePicker(id, name, value = '') {
    const safe = (value || '').replace(/"/g, '&quot;');
    return `
        <div class="date-picker-wrap">
            <input class="form-input date-text" type="text"
                   id="${id}" name="${name}"
                   value="${safe}"
                   placeholder="YYYY-MM-DD"
                   maxlength="10"
                   autocomplete="off"
                   inputmode="numeric">
            <button type="button" class="date-cal-btn" title="Pick from calendar" aria-label="Open calendar">
                <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24"
                     fill="none" stroke="currentColor" stroke-width="2"
                     stroke-linecap="round" stroke-linejoin="round">
                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                    <line x1="16" y1="2" x2="16" y2="6"></line>
                    <line x1="8" y1="2" x2="8" y2="6"></line>
                    <line x1="3" y1="10" x2="21" y2="10"></line>
                </svg>
            </button>
            <input type="date" class="date-hidden-cal" tabindex="-1" aria-hidden="true" value="${safe}">
        </div>`;
}

export function initDatePickers(container) {
    container.querySelectorAll('.date-picker-wrap').forEach(wrap => {
        const textInput = wrap.querySelector('.date-text');
        const calBtn    = wrap.querySelector('.date-cal-btn');
        const hiddenCal = wrap.querySelector('.date-hidden-cal');

        // Auto-insert hyphens as the user types digits
        textInput.addEventListener('input', () => {
            const cursorPos = textInput.selectionStart;
            const rawValue  = textInput.value;
            const digits    = rawValue.replace(/[^0-9]/g, '').slice(0, 8);

            // Build YYYY-MM-DD formatted string
            let formatted = '';
            for (let i = 0; i < digits.length; i++) {
                if (i === 4 || i === 6) formatted += '-';
                formatted += digits[i];
            }

            if (rawValue !== formatted) {
                // Count digits that were before the cursor in the original value
                let digitsBeforeCursor = 0;
                for (let i = 0; i < Math.min(cursorPos, rawValue.length); i++) {
                    if (/\d/.test(rawValue[i])) digitsBeforeCursor++;
                }
                // Find the matching cursor position in the formatted value
                let newPos = formatted.length;
                if (digitsBeforeCursor === 0) {
                    newPos = 0;
                } else {
                    let count = 0;
                    for (let i = 0; i < formatted.length; i++) {
                        if (/\d/.test(formatted[i])) {
                            count++;
                            if (count === digitsBeforeCursor) { newPos = i + 1; break; }
                        }
                    }
                }
                textInput.value = formatted;
                textInput.setSelectionRange(newPos, newPos);
            }

            // Keep the hidden calendar in sync when a full date is typed
            if (/^\d{4}-\d{2}-\d{2}$/.test(formatted)) {
                hiddenCal.value = formatted;
            } else {
                hiddenCal.value = '';
            }
        });

        // Calendar button → open native date picker
        calBtn.addEventListener('click', () => {
            const current = textInput.value;
            if (/^\d{4}-\d{2}-\d{2}$/.test(current)) {
                hiddenCal.value = current;
            }
            try {
                hiddenCal.showPicker();
            } catch {
                hiddenCal.focus();
            }
        });

        // When a date is chosen in the calendar, copy it to the text input
        hiddenCal.addEventListener('change', () => {
            if (hiddenCal.value) textInput.value = hiddenCal.value;
        });
    });
}
