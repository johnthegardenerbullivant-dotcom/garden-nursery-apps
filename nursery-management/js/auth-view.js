// =============================================================
//  auth-view.js — Login screen & access-denied screen
// =============================================================

import { signInWithGoogle, signInWithEmail, signInAsGuest, signOutUser } from './auth.js';
import { showToast } from './ui-utils.js';

export function showLoginOverlay() {
    const overlay = document.getElementById('login-overlay');
    if (!overlay) return;
    overlay.querySelector('.login-card').innerHTML = buildLoginCardHTML();
    overlay.style.display = 'flex';
    bindLoginEvents(overlay);
}

export function hideLoginOverlay() {
    const overlay = document.getElementById('login-overlay');
    if (overlay) overlay.style.display = 'none';
}

export function showAccessDenied(email) {
    const overlay = document.getElementById('login-overlay');
    if (!overlay) return;
    overlay.style.display = 'flex';
    overlay.querySelector('.login-card').innerHTML = `
        <div class="login-logo">🌱</div>
        <h1 class="login-title">Access Pending</h1>
        <p class="login-subtitle" style="text-align:center;margin-bottom:24px;line-height:1.6;">
            You've signed in as <strong>${escHtml(email)}</strong>,
            but your account hasn't been granted access yet.<br><br>
            Please ask the nursery admin to assign you a role in the Firebase Console.
        </p>
        <button class="btn btn-secondary" id="login-signout-pending-btn" style="width:100%;">
            Sign out
        </button>
    `;
    overlay.querySelector('#login-signout-pending-btn')?.addEventListener('click', async () => {
        await signOutUser();
        location.reload();
    });
}

function buildLoginCardHTML() {
    return `
        <div class="login-logo">🌱</div>
        <h1 class="login-title">Nursery Management</h1>
        <p class="login-subtitle">Sign in to access your nursery</p>

        <button class="btn-guest" id="guest-signin-btn">
            👀 Continue as Guest
        </button>
        <p style="font-size:0.78rem;color:var(--grey-400);text-align:center;margin:-6px 0 14px;">
            View-only · no account needed
        </p>

        <div class="login-divider"><span>or sign in</span></div>

        <button class="btn-google" id="google-signin-btn">
            <svg class="google-icon" width="18" height="18" viewBox="0 0 48 48">
                <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
                <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
                <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
                <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
                <path fill="none" d="M0 0h48v48H0z"/>
            </svg>
            Sign in with Google
        </button>

        <div class="login-divider"><span>or</span></div>

        <form id="email-signin-form" autocomplete="on" novalidate>
            <div class="form-group" style="margin-bottom:12px;">
                <label class="form-label" for="login-email">Email</label>
                <input class="form-input" type="email" id="login-email"
                       name="email" placeholder="your@email.com"
                       autocomplete="email" required>
            </div>
            <div class="form-group" style="margin-bottom:8px;">
                <label class="form-label" for="login-password">Password</label>
                <input class="form-input" type="password" id="login-password"
                       name="password" placeholder="••••••••"
                       autocomplete="current-password" required>
            </div>
            <p class="form-hint login-error" id="login-error" style="color:var(--red);min-height:1.2em;margin-bottom:8px;"></p>
            <button type="submit" class="btn btn-primary" id="email-signin-btn"
                    style="width:100%;">Sign in</button>
        </form>
    `;
}

function bindLoginEvents(overlay) {
    overlay.querySelector('#guest-signin-btn')?.addEventListener('click', async () => {
        const btn = overlay.querySelector('#guest-signin-btn');
        btn.disabled    = true;
        btn.textContent = 'Loading…';
        try {
            await signInAsGuest();
        } catch (e) {
            console.error('Guest sign-in error:', e);
            showToast('Could not start guest session. Please try again.', 'error');
            btn.disabled    = false;
            btn.textContent = '👀 Continue as Guest';
        }
    });

    overlay.querySelector('#google-signin-btn')?.addEventListener('click', async () => {
        const btn = overlay.querySelector('#google-signin-btn');
        btn.disabled = true;
        btn.textContent = 'Signing in…';
        try {
            await signInWithGoogle();
        } catch (e) {
            console.error('Google sign-in error:', e);
            const msg = e.code === 'auth/popup-closed-by-user'
                ? 'Sign-in cancelled.'
                : 'Google sign-in failed. Please try again.';
            showToast(msg, 'error');
            btn.disabled = false;
            btn.innerHTML = `<svg class="google-icon" width="18" height="18" viewBox="0 0 48 48">
                <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
                <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
                <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
                <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
            </svg> Sign in with Google`;
        }
    });

    overlay.querySelector('#email-signin-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email    = overlay.querySelector('#login-email')?.value.trim() || '';
        const password = overlay.querySelector('#login-password')?.value || '';
        const btn      = overlay.querySelector('#email-signin-btn');
        const errEl    = overlay.querySelector('#login-error');
        if (!email || !password) return;
        btn.disabled    = true;
        btn.textContent = 'Signing in…';
        if (errEl) errEl.textContent = '';
        try {
            await signInWithEmail(email, password);
        } catch (e) {
            console.error('Email sign-in error:', e);
            const msg =
                e.code === 'auth/invalid-credential'   ||
                e.code === 'auth/wrong-password'       ||
                e.code === 'auth/user-not-found'
                    ? 'Incorrect email or password. Please try again.'
                    : e.code === 'auth/too-many-requests'
                    ? 'Too many attempts. Please wait a moment and try again.'
                    : 'Sign-in failed. Please try again.';
            if (errEl) errEl.textContent = msg;
            btn.disabled    = false;
            btn.textContent = 'Sign in';
        }
    });
}

function escHtml(s) {
    return String(s || '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
