/* ================================================================
   Buchungssystem — Firebase App
   TC Schwarz-Weiss Golkrath e.V.
   ================================================================ */

(function () {
    'use strict';

    /* ── Firebase Referenzen ───────────────────────────── */
    const auth = firebase.auth();
    const db   = firebase.firestore();

    /* ── Konstanten ────────────────────────────────────── */
    const COURTS       = ['Platz 1', 'Platz 2', 'Platz 3'];
    const TIME_START   = 7;
    const TIME_END     = 22;
    const SLOT_STEP    = 0.5;
    const MAX_PER_DAY  = 2;
    const MAX_DAYS     = 14;
    const ADMIN_EMAIL  = 'tennisclubgolkrath@gmail.com';

    /* ── State ─────────────────────────────────────────── */
    let currentUser   = null;   // Firebase Auth User
    let userProfile   = null;   // Firestore user doc
    let selectedDate  = new Date();
    let activeCourt   = 0;      // Mobile-Tab

    /* ── DOM Refs ──────────────────────────────────────── */
    const $ = id => document.getElementById(id);

    const authView       = $('authView');
    const mainView       = $('mainView');
    const loginForm      = $('loginForm');
    const registerForm   = $('registerForm');
    const displayName    = $('displayName');
    const dateText       = $('dateText');
    const datePicker     = $('datePicker');
    const bookingGrid    = $('bookingGrid');
    const overlay        = $('overlay');
    const loadingBar     = $('loadingBar');

    /* ══════════════════════════════════════════════════════
       AUTH
       ══════════════════════════════════════════════════════ */

    // Auth-Tabs
    document.querySelectorAll('.auth-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            const isLogin = tab.dataset.tab === 'login';
            loginForm.style.display    = isLogin ? '' : 'none';
            registerForm.style.display = isLogin ? 'none' : '';
        });
    });

    // Google Sign-In
    $('btnGoogle').addEventListener('click', async () => {
        showLoading();
        try {
            const provider = new firebase.auth.GoogleAuthProvider();
            await auth.signInWithPopup(provider);
        } catch (err) {
            if (err.code !== 'auth/popup-closed-by-user') {
                toast(mapAuthError(err.code), 'error');
            }
            hideLoading();
        }
    });

    // Login
    loginForm.addEventListener('submit', async e => {
        e.preventDefault();
        const email = $('loginEmail').value.trim();
        const pw    = $('loginPassword').value;
        showLoading();
        try {
            await auth.signInWithEmailAndPassword(email, pw);
        } catch (err) {
            toast(mapAuthError(err.code), 'error');
            hideLoading();
        }
    });

    // Registrierung
    registerForm.addEventListener('submit', async e => {
        e.preventDefault();
        const firstName = $('regFirstName').value.trim();
        const lastName  = $('regLastName').value.trim();
        const email     = $('regEmail').value.trim();
        const pw        = $('regPassword').value;

        if (!firstName || !lastName) {
            toast('Bitte Vor- und Nachname eingeben.', 'error');
            return;
        }

        showLoading();
        try {
            const cred = await auth.createUserWithEmailAndPassword(email, pw);
            // Profil in Firestore anlegen (inaktiv bis Admin freischaltet)
            await db.collection('users').doc(cred.user.uid).set({
                firstName,
                lastName,
                email,
                role: 'member',
                active: false,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            notifyAdmin(firstName, lastName, email);
            auth.signOut();
            toast('Registrierung erfolgreich! Der Admin wird informiert und schaltet dein Konto frei.', 'info');
            hideLoading();
        } catch (err) {
            toast(mapAuthError(err.code), 'error');
            hideLoading();
        }
    });

    // Auth State Observer
    auth.onAuthStateChanged(async user => {
        if (user) {
            currentUser = user;
            await loadUserProfile();
            if (!userProfile) {
                // Neues Profil aus Social-Login (inaktiv bis Admin freischaltet)
                const parts = (user.displayName || '').split(' ');
                const firstName = parts[0] || 'Benutzer';
                const lastName  = parts.slice(1).join(' ') || '';
                const email     = user.email || '';
                await db.collection('users').doc(user.uid).set({
                    firstName,
                    lastName,
                    email,
                    role: 'member',
                    active: false,
                    createdAt: firebase.firestore.FieldValue.serverTimestamp()
                });
                notifyAdmin(firstName, lastName, email);
                toast('Registrierung erfolgreich! Der Admin wird informiert und schaltet dein Konto frei.', 'info');
                auth.signOut();
                hideLoading();
                return;
            }
            if (!userProfile.active) {
                toast('Dein Konto ist noch nicht freigeschaltet. Kontaktiere den Administrator.', 'error');
                auth.signOut();
                return;
            }
            showApp();
        } else {
            currentUser = null;
            userProfile = null;
            showAuth();
        }
        hideLoading();
    });

    async function loadUserProfile() {
        const doc = await db.collection('users').doc(currentUser.uid).get();
        userProfile = doc.exists ? doc.data() : null;
    }

    function showAuth() {
        authView.style.display = '';
        mainView.style.display = 'none';
    }

    function showApp() {
        authView.style.display = 'none';
        mainView.style.display = '';
        displayName.textContent = userProfile.firstName + ' ' + userProfile.lastName;
        $('btnAdmin').style.display = userProfile.role === 'admin' ? '' : 'none';
        resetToToday();
    }

    // Logout
    $('btnLogout').addEventListener('click', () => auth.signOut());

    /* ══════════════════════════════════════════════════════
       DATUM-NAVIGATION
       ══════════════════════════════════════════════════════ */

    function resetToToday() {
        selectedDate = new Date();
        selectedDate.setHours(0, 0, 0, 0);
        updateDateDisplay();
        loadBookings();
    }

    function updateDateDisplay() {
        const opts = { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' };
        dateText.textContent = selectedDate.toLocaleDateString('de-DE', opts);
        datePicker.value = formatDate(selectedDate);
        updateCalStrip();
    }

    $('btnPrevDay').addEventListener('click', () => changeDay(-1));
    $('btnNextDay').addEventListener('click', () => changeDay(1));
    $('btnToday').addEventListener('click', resetToToday);

    // Kalender-Toggle
    $('btnToggleCal').addEventListener('click', () => {
        const strip = $('calStrip');
        const isHidden = strip.style.display === 'none';
        strip.style.display = isHidden ? 'flex' : 'none';
        $('btnToggleCal').textContent = isHidden ? 'Kalender ▲' : 'Kalender';
        if (isHidden) renderCalStrip();
    });

    function renderCalStrip() {
        const strip = $('calStrip');
        strip.innerHTML = '';
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const dayNames = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
        const monthNames = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];

        for (let i = 0; i <= MAX_DAYS; i++) {
            const d = new Date(today);
            d.setDate(d.getDate() + i);
            const btn = document.createElement('div');
            btn.className = 'cal-day';
            if (formatDate(d) === formatDate(selectedDate)) btn.classList.add('active');
            if (i === 0) btn.classList.add('today');
            btn.innerHTML = `<span class="cal-day-name">${dayNames[d.getDay()]}</span><span class="cal-day-num">${d.getDate()}</span><span class="cal-day-month">${monthNames[d.getMonth()]}</span>`;
            btn.addEventListener('click', () => {
                selectedDate = new Date(d);
                updateDateDisplay();
                loadBookings();
            });
            strip.appendChild(btn);
        }
    }

    function updateCalStrip() {
        const strip = $('calStrip');
        if (strip.style.display === 'none') return;
        strip.querySelectorAll('.cal-day').forEach((el, i) => {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const d = new Date(today);
            d.setDate(d.getDate() + i);
            el.classList.toggle('active', formatDate(d) === formatDate(selectedDate));
        });
    }

    datePicker.addEventListener('change', e => {
        const parts = e.target.value.split('-');
        selectedDate = new Date(parts[0], parts[1] - 1, parts[2]);
        updateDateDisplay();
        loadBookings();
    });

    function changeDay(delta) {
        selectedDate.setDate(selectedDate.getDate() + delta);
        updateDateDisplay();
        loadBookings();
    }

    /* ══════════════════════════════════════════════════════
       PLATZ-TABS (MOBILE)
       ══════════════════════════════════════════════════════ */

    document.querySelectorAll('.court-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.court-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            activeCourt = parseInt(tab.dataset.court);
            renderGrid(lastBookings);
        });
    });

    /* ══════════════════════════════════════════════════════
       BUCHUNGEN LADEN & RENDERN
       ══════════════════════════════════════════════════════ */

    let lastBookings = [];

    async function loadBookings() {
        showLoading();
        const dateStr = formatDate(selectedDate);
        try {
            const snap = await db.collection('bookings')
                .where('date', '==', dateStr)
                .get();
            lastBookings = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            renderGrid(lastBookings);
        } catch (err) {
            toast('Fehler beim Laden der Buchungen.', 'error');
        }
        hideLoading();
    }

    function renderGrid(bookings) {
        const isMobile = window.innerWidth <= 768;
        const courts   = isMobile ? [activeCourt] : [0, 1, 2];
        const cols     = courts.length + 1; // +1 fuer Zeit-Spalte
        const now      = new Date();
        const dateStr  = formatDate(selectedDate);
        const isToday  = formatDate(now) === dateStr;
        const isPast   = selectedDate < new Date(now.getFullYear(), now.getMonth(), now.getDate());

        bookingGrid.style.gridTemplateColumns = `60px repeat(${courts.length}, 1fr)`;
        bookingGrid.innerHTML = '';

        // Header
        const timeHeader = document.createElement('div');
        timeHeader.className = 'grid-header';
        timeHeader.textContent = 'Zeit';
        bookingGrid.appendChild(timeHeader);

        courts.forEach(c => {
            const h = document.createElement('div');
            h.className = 'grid-header';
            h.textContent = COURTS[c];
            bookingGrid.appendChild(h);
        });

        // Zeilen
        for (let slot = TIME_START; slot < TIME_END; slot += SLOT_STEP) {
            const h = Math.floor(slot);
            const m = (slot % 1) * 60;
            const endSlot = slot + SLOT_STEP;
            const eh = Math.floor(endSlot);
            const em = (endSlot % 1) * 60;
            // Zeit-Zelle
            const timeCell = document.createElement('div');
            timeCell.className = 'grid-time';
            timeCell.innerHTML = `${pad(h)}:${pad(m)}<span class="time-end">${pad(eh)}:${pad(em)}</span>`;
            bookingGrid.appendChild(timeCell);

            courts.forEach(courtIdx => {
                const slotEl = document.createElement('div');
                slotEl.className = 'grid-slot';

                const nowMinutes = now.getHours() * 60 + now.getMinutes();
                const slotMinutes = h * 60 + m;
                const slotPast = isPast || (isToday && slotMinutes < nowMinutes);
                const booking  = bookings.find(b =>
                    b.courtId === courtIdx && b.timeSlot === slot
                );

                if (slotPast) {
                    slotEl.classList.add('past');
                    if (booking) {
                        slotEl.innerHTML = `<span class="slot-name">${esc(booking.userName)}</span>`;
                    } else {
                        slotEl.textContent = '-';
                    }
                } else if (booking) {
                    const isOwn = booking.userId === currentUser.uid;
                    slotEl.classList.add(isOwn ? 'own' : 'booked');
                    slotEl.innerHTML = `<span class="slot-name">${esc(booking.userName)}</span>`;
                    if (isOwn) {
                        const btn = document.createElement('button');
                        btn.className = 'btn-cancel';
                        btn.textContent = 'Stornieren';
                        btn.addEventListener('click', () => cancelBooking(booking.id));
                        slotEl.appendChild(btn);
                    }
                } else {
                    slotEl.classList.add('free');
                    slotEl.textContent = 'Frei';
                    slotEl.addEventListener('click', () => bookSlot(courtIdx, slot));
                }

                bookingGrid.appendChild(slotEl);
            });
        }
    }

    // Responsiv: Grid neu rendern bei Resize
    let resizeTimer;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => renderGrid(lastBookings), 200);
    });

    /* ══════════════════════════════════════════════════════
       BUCHEN & STORNIEREN
       ══════════════════════════════════════════════════════ */

    async function bookSlot(courtId, timeSlot) {
        const dateStr = formatDate(selectedDate);
        const today   = new Date();
        today.setHours(0, 0, 0, 0);

        // Zukunfts-Check
        const maxDate = new Date(today);
        maxDate.setDate(maxDate.getDate() + MAX_DAYS);
        if (selectedDate > maxDate) {
            toast(`Buchungen sind nur ${MAX_DAYS} Tage im Voraus moeglich.`, 'error');
            return;
        }

        showLoading();
        try {
            // Tagesbuchungen des Benutzers pruefen
            const mySnap = await db.collection('bookings')
                .where('date', '==', dateStr)
                .where('userId', '==', currentUser.uid)
                .get();

            if (mySnap.size >= MAX_PER_DAY) {
                toast(`Max. ${MAX_PER_DAY} Buchungen pro Tag.`, 'error');
                hideLoading();
                return;
            }

            // Slot noch frei?
            const slotSnap = await db.collection('bookings')
                .where('date', '==', dateStr)
                .where('courtId', '==', courtId)
                .where('timeSlot', '==', timeSlot)
                .get();

            if (!slotSnap.empty) {
                toast('Dieser Slot ist bereits belegt.', 'error');
                hideLoading();
                loadBookings();
                return;
            }

            await db.collection('bookings').add({
                userId:    currentUser.uid,
                userName:  userProfile.firstName + ' ' + userProfile.lastName,
                courtId:   courtId,
                date:      dateStr,
                timeSlot:  timeSlot,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });

            toast('Buchung erfolgreich!', 'success');
            loadBookings();
        } catch (err) {
            toast('Fehler beim Buchen.', 'error');
            hideLoading();
        }
    }

    async function cancelBooking(bookingId) {
        if (!confirm('Buchung wirklich stornieren?')) return;
        showLoading();
        try {
            await db.collection('bookings').doc(bookingId).delete();
            toast('Buchung storniert.', 'success');
            loadBookings();
        } catch (err) {
            toast('Fehler beim Stornieren.', 'error');
            hideLoading();
        }
    }

    /* ══════════════════════════════════════════════════════
       PANELS
       ══════════════════════════════════════════════════════ */

    function openPanel(id) {
        $(id).classList.add('open');
        overlay.classList.add('show');
    }
    function closePanel(id) {
        $(id).classList.remove('open');
        overlay.classList.remove('show');
    }
    function closeAll() {
        document.querySelectorAll('.side-panel').forEach(p => p.classList.remove('open'));
        overlay.classList.remove('show');
    }

    overlay.addEventListener('click', closeAll);
    document.querySelectorAll('[data-close]').forEach(btn => {
        btn.addEventListener('click', () => closePanel(btn.dataset.close));
    });

    /* ── Meine Buchungen ─────────────────────────────── */
    $('btnMyBookings').addEventListener('click', async () => {
        openPanel('panelMyBookings');
        const list = $('myBookingsList');
        list.innerHTML = '<p class="empty-msg">Laden...</p>';

        try {
            const today = formatDate(new Date());
            const snap  = await db.collection('bookings')
                .where('userId', '==', currentUser.uid)
                .where('date', '>=', today)
                .orderBy('date')
                .orderBy('timeSlot')
                .get();

            if (snap.empty) {
                list.innerHTML = '<p class="empty-msg">Keine aktuellen Buchungen.</p>';
                return;
            }

            list.innerHTML = '';
            snap.docs.forEach(doc => {
                const b = doc.data();
                const item = document.createElement('div');
                item.className = 'my-booking-item';
                item.innerHTML = `
                    <div class="my-booking-info">
                        <span class="my-booking-date">${formatDateDE(b.date)}</span>
                        <span class="my-booking-time">${formatSlotTime(b.timeSlot)}</span>
                        <span class="my-booking-court">${COURTS[b.courtId]}</span>
                    </div>
                    <button class="btn btn-sm" style="color:var(--danger);border-color:var(--danger)">Stornieren</button>
                `;
                item.querySelector('button').addEventListener('click', async () => {
                    await cancelBooking(doc.id);
                    // Panel neu laden
                    $('btnMyBookings').click();
                });
                list.appendChild(item);
            });
        } catch (err) {
            list.innerHTML = '<p class="empty-msg">Fehler beim Laden.</p>';
        }
    });

    /* ── Passwort aendern ──────────────────────────────── */
    $('btnPassword').addEventListener('click', () => openPanel('panelPassword'));

    $('passwordForm').addEventListener('submit', async e => {
        e.preventDefault();
        const pw  = $('newPassword').value;
        const pw2 = $('confirmPassword').value;

        if (pw !== pw2) {
            toast('Passwoerter stimmen nicht ueberein.', 'error');
            return;
        }

        showLoading();
        try {
            await currentUser.updatePassword(pw);
            toast('Passwort geaendert.', 'success');
            $('passwordForm').reset();
            closePanel('panelPassword');
        } catch (err) {
            if (err.code === 'auth/requires-recent-login') {
                toast('Bitte erneut anmelden, um das Passwort zu aendern.', 'error');
            } else {
                toast('Fehler beim Aendern des Passworts.', 'error');
            }
        }
        hideLoading();
    });

    /* ── Admin-Panel ───────────────────────────────────── */
    $('btnAdmin').addEventListener('click', async () => {
        openPanel('panelAdmin');
        const list = $('adminUserList');
        list.innerHTML = '<p class="empty-msg">Laden...</p>';

        try {
            const snap = await db.collection('users').orderBy('lastName').get();
            list.innerHTML = '';

            snap.docs.forEach(doc => {
                const u = doc.data();
                const uid = doc.id;
                const item = document.createElement('div');
                item.className = 'admin-user-item';
                item.innerHTML = `
                    <div class="admin-user-info">
                        <span class="admin-user-name">${esc(u.firstName)} ${esc(u.lastName)}</span>
                        <span class="admin-user-email">${esc(u.email)}</span>
                        <div class="admin-user-meta">
                            <span class="badge ${u.role === 'admin' ? 'badge-admin' : 'badge-member'}">${u.role === 'admin' ? 'Admin' : 'Mitglied'}</span>
                            <span class="badge ${u.active ? 'badge-active' : 'badge-inactive'}">${u.active ? 'Aktiv' : 'Inaktiv'}</span>
                        </div>
                    </div>
                    <div class="admin-user-actions"></div>
                `;

                const actions = item.querySelector('.admin-user-actions');

                // Rolle umschalten
                const roleBtn = document.createElement('button');
                roleBtn.className = 'btn btn-sm btn-outline';
                roleBtn.textContent = u.role === 'admin' ? 'Mitglied' : 'Admin';
                roleBtn.addEventListener('click', async () => {
                    await db.collection('users').doc(uid).update({
                        role: u.role === 'admin' ? 'member' : 'admin'
                    });
                    toast('Rolle geaendert.', 'success');
                    $('btnAdmin').click();
                });
                actions.appendChild(roleBtn);

                // Aktiv/Inaktiv umschalten
                const statusBtn = document.createElement('button');
                statusBtn.className = 'btn btn-sm btn-outline';
                statusBtn.textContent = u.active ? 'Deaktivieren' : 'Aktivieren';
                statusBtn.style.cssText = u.active
                    ? 'color:var(--danger);border-color:var(--danger)'
                    : 'color:var(--success);border-color:var(--success)';
                statusBtn.addEventListener('click', async () => {
                    await db.collection('users').doc(uid).update({
                        active: !u.active
                    });
                    toast(u.active ? 'Benutzer deaktiviert.' : 'Benutzer aktiviert.', 'success');
                    $('btnAdmin').click();
                });
                actions.appendChild(statusBtn);

                list.appendChild(item);
            });
        } catch (err) {
            list.innerHTML = '<p class="empty-msg">Fehler beim Laden.</p>';
        }
    });

    /* ══════════════════════════════════════════════════════
       HILFSFUNKTIONEN
       ══════════════════════════════════════════════════════ */

    function formatDate(d) {
        return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    }

    function formatDateDE(str) {
        const parts = str.split('-');
        return parts[2] + '.' + parts[1] + '.' + parts[0];
    }

    function pad(n) {
        return String(Math.floor(n)).padStart(2, '0');
    }

    function formatSlotTime(slot) {
        const h = Math.floor(slot);
        const m = (slot % 1) * 60;
        const eh = Math.floor(slot + SLOT_STEP);
        const em = ((slot + SLOT_STEP) % 1) * 60;
        return pad(h) + ':' + pad(m) + ' - ' + pad(eh) + ':' + pad(em);
    }

    function esc(str) {
        const div = document.createElement('div');
        div.textContent = str || '';
        return div.innerHTML;
    }

    /* ── Toast ─────────────────────────────────────────── */
    function toast(msg, type) {
        const container = $('toastContainer');
        const el = document.createElement('div');
        el.className = 'toast toast-' + (type || 'info');
        el.textContent = msg;
        container.appendChild(el);
        requestAnimationFrame(() => el.classList.add('show'));
        setTimeout(() => {
            el.classList.remove('show');
            setTimeout(() => el.remove(), 300);
        }, 3500);
    }

    /* ── Loading Bar ───────────────────────────────────── */
    function showLoading() { loadingBar.style.width = '70%'; }
    function hideLoading() {
        loadingBar.style.width = '100%';
        setTimeout(() => {
            loadingBar.style.transition = 'none';
            loadingBar.style.width = '0';
            requestAnimationFrame(() => {
                loadingBar.style.transition = '';
            });
        }, 300);
    }

    /* ── Admin-Benachrichtigung (EmailJS, kostenlos) ──── */
    function notifyAdmin(firstName, lastName, email) {
        try {
            emailjs.send('default_service', 'new_member', {
                to_email:    ADMIN_EMAIL,
                member_name: firstName + ' ' + lastName,
                member_email: email
            });
        } catch (e) {
            // Fehler bei E-Mail ignorieren - Registrierung ist trotzdem gespeichert
        }
    }

    /* ── Fehlermeldungen ───────────────────────────────── */
    function mapAuthError(code) {
        const map = {
            'auth/invalid-email':         'Ungueltige E-Mail-Adresse.',
            'auth/user-disabled':         'Dieses Konto ist deaktiviert.',
            'auth/user-not-found':        'E-Mail oder Passwort falsch.',
            'auth/wrong-password':        'E-Mail oder Passwort falsch.',
            'auth/invalid-credential':    'E-Mail oder Passwort falsch.',
            'auth/email-already-in-use':  'Diese E-Mail ist bereits registriert.',
            'auth/weak-password':         'Das Passwort muss mindestens 6 Zeichen haben.',
            'auth/too-many-requests':     'Zu viele Versuche. Bitte spaeter erneut versuchen.',
            'auth/network-request-failed':'Netzwerkfehler. Pruefe deine Verbindung.',
        };
        return map[code] || 'Ein Fehler ist aufgetreten (' + code + ')';
    }

})();
