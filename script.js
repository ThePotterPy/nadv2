// NAD Constructora — Script Principal & CMS Client
function safeCreateIcons() {
    try {
        if (typeof lucide !== 'undefined' && lucide && typeof lucide.createIcons === 'function') {
            lucide.createIcons();
        }
    } catch (e) {}
}

safeCreateIcons();

document.addEventListener('DOMContentLoaded', () => {

    // ── Variables globales y elementos base ─────────────────────────────────
    const header        = document.getElementById('header');
    const progressBar   = document.getElementById('scroll-progress');
    const backToTop     = document.getElementById('back-to-top');
    const mobileMenuBtn = document.getElementById('mobile-menu-btn');
    const mobileNav     = document.getElementById('mobile-nav');
    let menuOpen = false;

    // Elementos del Modal
    const modal      = document.getElementById('project-modal');
    const modalClose = document.getElementById('modal-close');
    const modalImg   = document.getElementById('modal-img');
    const modalTitle = document.getElementById('modal-title');
    const modalCat   = document.getElementById('modal-category');
    const modalDesc  = document.getElementById('modal-desc');
    const modalLoc   = document.getElementById('modal-location');
    const modalYear  = document.getElementById('modal-year');
    const modalCta   = document.getElementById('modal-cta-btn');
    let lastModalFocus = null;

    // Lógica para compartir
    const shareBtn = document.getElementById('modal-share-btn');
    if (shareBtn) {
        shareBtn.addEventListener('click', () => {
            if (navigator.share) {
                navigator.share({
                    title: document.getElementById('modal-title').textContent,
                    url: window.location.href
                }).catch(err => console.error(err));
            } else {
                navigator.clipboard.writeText(window.location.href);
                alert('Enlace copiado al portapapeles');
            }
        });
    }


    // Botón Ver Más Proyectos
    const btnVerMas       = document.getElementById('btn-ver-mas-proyectos');
    const btnText         = document.getElementById('btn-ver-mas-text');
    const btnIcon         = document.getElementById('btn-ver-mas-icon');
    const projectsActWrap = document.getElementById('projects-action-wrap');

    // Estado de textos del CMS para el botón
    let cmsTexts = {
        btn_ver_mas: 'Ver más proyectos',
        btn_ver_menos: 'Ver menos proyectos'
    };

    // Helper para escapar HTML seguro
    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function sanitizeCmsHtml(html) {
        const template = document.createElement('template');
        template.innerHTML = String(html == null ? '' : html);
        const allowedTags = new Set(['SPAN', 'BR', 'STRONG', 'EM', 'B', 'I']);

        Array.from(template.content.querySelectorAll('*')).forEach(el => {
            if (!allowedTags.has(el.tagName)) {
                el.replaceWith(document.createTextNode(el.textContent || ''));
                return;
            }

            Array.from(el.attributes).forEach(attr => {
                const allowedGradientClass = el.tagName === 'SPAN' &&
                    attr.name === 'class' &&
                    attr.value.split(/\s+/).filter(Boolean).every(c => c === 'text-gradient');
                if (!allowedGradientClass) el.removeAttribute(attr.name);
            });
        });

        return template.innerHTML;
    }

    function safeHttpUrl(value) {
        if (!value) return null;
        try {
            const url = new URL(String(value), window.location.origin);
            if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
            return url.href;
        } catch (e) {
            return null;
        }
    }

    function safeMediaUrl(value) {
        if (!value) return null;
        try {
            const url = new URL(String(value), window.location.origin);
            if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
            return url.href;
        } catch (e) {
            return null;
        }
    }

    // Identifica la plataforma de un link para "Publicaciones Recientes" (ícono +
    // color + nombre). Cualquier dominio no reconocido cae en un link genérico.
    function detectPlatform(url) {
        let host = '';
        try { host = new URL(url).hostname.replace(/^www\./, ''); } catch (e) { }
        if (host.includes('instagram.com')) return { name: 'Instagram', icon: 'fa-instagram', brand: true, color: '#E4405F' };
        if (host.includes('facebook.com') || host.includes('fb.watch')) return { name: 'Facebook', icon: 'fa-facebook', brand: true, color: '#1877F2' };
        if (host.includes('tiktok.com')) return { name: 'TikTok', icon: 'fa-tiktok', brand: true, color: '#111111' };
        if (host.includes('twitter.com') || host.includes('x.com')) return { name: 'X', icon: 'fa-x-twitter', brand: true, color: '#111111' };
        if (host.includes('linkedin.com')) return { name: 'LinkedIn', icon: 'fa-linkedin', brand: true, color: '#0A66C2' };
        if (host.includes('youtube.com') || host.includes('youtu.be')) return { name: 'YouTube', icon: 'fa-youtube', brand: true, color: '#FF0000' };
        return { name: host || 'enlace externo', icon: 'fa-link', brand: false, color: 'var(--primary)' };
    }

    // Tarjeta con estilo propio del sitio para un link a una publicación externa
    // (reemplaza los widgets nativos de cada red, que son frágiles y no pegan
    // visualmente con el resto del sitio).
    function buildLinkCard(url) {
        const p = detectPlatform(url);
        const iconClass = (p.brand ? 'fa-brands ' : 'fa-solid ') + p.icon;
        const safeUrl = safeHttpUrl(url) || '#';
        return `<a href="${escapeHtml(safeUrl)}" target="_blank" rel="noopener noreferrer" class="post-link-card">
            <span class="post-link-icon" style="background:${p.color}"><i class="${iconClass}"></i></span>
            <span class="post-link-text"><strong>Ver publicación</strong><small>en ${escapeHtml(p.name)}</small></span>
            <i class="fa-solid fa-arrow-up-right-from-square post-link-arrow"></i>
        </a>`;
    }

    // ── Header, Scroll Progress & Parallax ──────────────────────────────────
    // En móvil el header ocupa mucho lugar: se esconde al bajar y reaparece
    // al subir, pero recién después de pasar HIDE_THRESHOLD (no desaparece
    // apenas se empieza a scrollear).
    let lastScrollY = window.scrollY;
    const HIDE_THRESHOLD = 160;

    window.addEventListener('scroll', () => {
        const scrollTop     = window.scrollY;
        const docHeight     = document.documentElement.scrollHeight - window.innerHeight;
        const scrollPercent = docHeight > 0 ? (scrollTop / docHeight) * 100 : 0;

        if (progressBar) progressBar.style.transform = `scaleX(${scrollPercent / 100})`;
        if (header)      header.classList.toggle('scrolled', scrollTop > 50);
        if (backToTop)   backToTop.classList.toggle('visible', scrollTop > 400);

        if (header && window.innerWidth <= 768) {
            if (scrollTop > lastScrollY && scrollTop > HIDE_THRESHOLD) {
                header.classList.add('header-hidden');
            } else if (scrollTop < lastScrollY) {
                header.classList.remove('header-hidden');
            }
        }
        lastScrollY = scrollTop;

        const heroBg = document.querySelector('.hero-bg');
        if (heroBg && scrollTop < window.innerHeight * 1.2) {
            heroBg.style.transform = `translateY(${scrollTop * 0.35}px)`;
        }

        let current = '';
        document.querySelectorAll('section[id]').forEach(section => {
            if (scrollTop >= section.offsetTop - 200) {
                current = section.getAttribute('id');
            }
        });
        document.querySelectorAll('.nav-links a').forEach(a => {
            a.classList.toggle('active', a.getAttribute('href') === `#${current}`);
        });
    });

    if (backToTop) {
        backToTop.addEventListener('click', () => {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
    }

    // ── Menú Móvil ──────────────────────────────────────────────────────────
    function toggleMenu() {
        menuOpen = !menuOpen;
        mobileNav.classList.toggle('open', menuOpen);
        mobileMenuBtn.setAttribute('aria-expanded', String(menuOpen));
        mobileMenuBtn.setAttribute('aria-label', menuOpen ? 'Cerrar menú' : 'Abrir menú');
        mobileMenuBtn.innerHTML = menuOpen
            ? '<i data-lucide="x"></i>'
            : '<i data-lucide="menu"></i>';
        safeCreateIcons();
    }

    if (mobileMenuBtn) {
        mobileMenuBtn.setAttribute('aria-expanded', 'false');
        mobileMenuBtn.setAttribute('aria-controls', 'mobile-nav');
        mobileMenuBtn.addEventListener('click', toggleMenu);
    }
    document.querySelectorAll('.mobile-link').forEach(link => {
        link.addEventListener('click', () => { if (menuOpen) toggleMenu(); });
    });

    // ── Contador de Estadísticas ────────────────────────────────────────────
    function animateCounter(el, target, duration = 1800) {
        const raw    = el.textContent.trim();
        const prefix = raw.startsWith('+') ? '+' : '';
        const suffix = raw.endsWith('%')   ? '%' : '';
        const start  = 0;
        const startTime = performance.now();

        function update(currentTime) {
            const elapsed  = currentTime - startTime;
            const progress = Math.min(elapsed / duration, 1);
            const eased    = 1 - Math.pow(1 - progress, 3);
            const value    = Math.round(start + (target - start) * eased);
            el.textContent = prefix + value + suffix;
            if (progress < 1) requestAnimationFrame(update);
        }
        requestAnimationFrame(update);
    }

    // Observers
    const fadeObserver = new IntersectionObserver((entries, obs) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('visible');
                obs.unobserve(entry.target);
            }
        });
    }, { threshold: 0.1 });

    function observeFadeUpElements() {
        document.querySelectorAll('.fade-up:not(.visible)').forEach(el => {
            const rect = el.getBoundingClientRect();
            if (rect.top < window.innerHeight + 100) {
                el.classList.add('visible');
            } else {
                fadeObserver.observe(el);
            }
        });
    }
    observeFadeUpElements();

    // Respaldo de seguridad para garantizar visibilidad total
    setTimeout(() => {
        document.querySelectorAll('.fade-up:not(.visible)').forEach(el => el.classList.add('visible'));
    }, 400);

    const statObserver = new IntersectionObserver((entries, obs) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const el  = entry.target;
                const raw = el.textContent.trim();
                const num = parseInt(raw.replace(/[^0-9]/g, ''), 10);
                if (!isNaN(num)) animateCounter(el, num);
                obs.unobserve(el);
            }
        });
    }, { threshold: 0.5 });

    document.querySelectorAll('.stat-number').forEach(el => statObserver.observe(el));

    // ── Efecto 3D Tilt en Tarjetas ──────────────────────────────────────────
    function bindTiltEffect(container) {
        const cards = container ? container.querySelectorAll('.project-card') : document.querySelectorAll('.project-card');
        cards.forEach(card => {
            card.removeEventListener('mousemove', card._tiltMove);
            card.removeEventListener('mouseleave', card._tiltLeave);

            card._tiltMove = e => {
                const rect    = card.getBoundingClientRect();
                const x       = e.clientX - rect.left;
                const y       = e.clientY - rect.top;
                const cx      = rect.width  / 2;
                const cy      = rect.height / 2;
                const rotateX = ((y - cy) / cy) * -6;
                const rotateY = ((x - cx) / cx) *  6;
                card.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateZ(6px)`;
            };
            card._tiltLeave = () => { card.style.transform = ''; };

            card.addEventListener('mousemove', card._tiltMove);
            card.addEventListener('mouseleave', card._tiltLeave);
        });
    }
    bindTiltEffect();

    // ── Modal de Proyectos con Soporte de Video e Imagen ───────────────────
    const modalVideo = document.getElementById('modal-video');

    // ── Formateador de descripción para listas y saltos de fila ─────────────
    function formatProjectDescription(raw) {
        if (!raw) return '';
        let t = String(raw).trim().replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        const lines = t.split('\n');
        const processed = [];
        for (let line of lines) {
            let trimmed = line.trim();
            if (!trimmed) {
                processed.push('');
                continue;
            }
            const hasMultipleDashes = (trimmed.match(/\s+[-•*](?:\s*)(?=[A-Za-z\u00C0-\u017F])/g) || []).length >= 2;
            if (/^[-•*]/.test(trimmed) || hasMultipleDashes) {
                if (!/^[-•*]/.test(trimmed) && hasMultipleDashes) {
                    trimmed = '- ' + trimmed;
                }
                trimmed = trimmed.replace(/\s+([-•*])(?:\s*)(?=[A-Za-z\u00C0-\u017F])/g, '\n$1 ');
                trimmed = trimmed.replace(/^([-•*])(?=[A-Za-z\u00C0-\u017F])/gm, '$1 ');
                processed.push(trimmed);
            } else {
                processed.push(line);
            }
        }
        return processed.join('\n').trim();
    }

    function openModal(btn) {
        if (!modal) return;
        lastModalFocus = document.activeElement;
        const mediaUrl = btn.dataset.image || '';
        const isVideo  = /\.(mp4|webm|mov)$/i.test(mediaUrl);

        const modalContainer = modal.querySelector('.modal-container');
        if (modalContainer) modalContainer.scrollTop = 0;

        if (isVideo && modalVideo) {
            if (modalImg) modalImg.style.display = 'none';
            modalVideo.style.display = 'block';
            modalVideo.src = mediaUrl;
            modalVideo.play().catch(() => {});
        } else {
            if (modalVideo) {
                modalVideo.pause();
                modalVideo.style.display = 'none';
                modalVideo.src = '';
            }
            if (modalImg) {
                modalImg.style.display = 'block';
                modalImg.src = mediaUrl || '/nad.png';
                modalImg.onerror = function() { this.src = '/nad.png'; };
            }
        }

        let rawDesc = '';
        if (btn.dataset.id && window.__nadProjectsById && window.__nadProjectsById[btn.dataset.id]) {
            rawDesc = window.__nadProjectsById[btn.dataset.id].description || '';
        } else {
            rawDesc = btn.dataset.desc || '';
        }

        modalTitle.textContent = btn.dataset.title || '';
        modalCat.textContent   = btn.dataset.category || '';
        modalDesc.textContent  = formatProjectDescription(rawDesc);
        modalLoc.textContent   = btn.dataset.location || '';
        modalYear.textContent  = btn.dataset.year || '';

        if (modalCta && btn.dataset.title) {
            const query = encodeURIComponent(`Hola NAD, tengo un proyecto similar a "${btn.dataset.title}" en mente. ¿Podemos agendar una reunión?`);
            modalCta.href = `https://wa.me/595981076445?text=${query}`;
        }

        modal.style.display = 'flex';
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                modal.classList.add('active');
                modal.setAttribute('aria-hidden', 'false');
                document.body.style.overflow = 'hidden';
                if (modalClose) modalClose.focus();
                safeCreateIcons();
            });
        });
    }

    function closeModal() {
        if (!modal) return;
        if (modalVideo) {
            modalVideo.pause();
            modalVideo.src = '';
        }
        modal.classList.remove('active');
        modal.setAttribute('aria-hidden', 'true');
        document.body.style.overflow = '';
        setTimeout(() => {
            if (!modal.classList.contains('active')) {
                modal.style.display = 'none';
                if (lastModalFocus && typeof lastModalFocus.focus === 'function') lastModalFocus.focus();
            }
        }, 400);
    }

    function bindModalButtons(container) {
        const btns = container ? container.querySelectorAll('.open-modal-btn') : document.querySelectorAll('.open-modal-btn');
        btns.forEach(btn => {
            btn.removeEventListener('click', btn._modalClick);
            btn._modalClick = () => openModal(btn);
            btn.addEventListener('click', btn._modalClick);
        });
        // Toda la tarjeta responde al toque (en móvil no hay hover para revelar
        // el botón interno, así que antes hacía falta tocar dos veces).
        const cards = container ? container.querySelectorAll('.project-card') : document.querySelectorAll('.project-card');
        cards.forEach(card => {
            card.removeEventListener('click', card._cardClick);
            card._cardClick = (e) => {
                if (e.target.closest('.open-modal-btn')) return;
                const btn = card.querySelector('.open-modal-btn');
                if (btn) openModal(btn);
            };
            card.addEventListener('click', card._cardClick);
        });
    }
    bindModalButtons();

    if (modalClose) modalClose.addEventListener('click', closeModal);
    if (modal) {
        modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });
    }
    document.addEventListener('keydown', e => {
        if (!modal || !modal.classList.contains('active')) return;
        if (e.key === 'Escape') {
            closeModal();
            return;
        }
        if (e.key === 'Tab') {
            const focusable = Array.from(modal.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'))
                .filter(el => !el.hasAttribute('hidden') && el.offsetParent !== null);
            if (!focusable.length) return;
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
            else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        }
    });

    // (Botón "Ver más proyectos" ahora es un enlace a proyectos, no requiere JS)

    // ── Cargar Contenido y Estilos Dinámicos (CMS) ──────────────────────────
    async function loadSiteContent() {
        try {
            const res = await fetch('/api/content');
            if (!res.ok) return;
            const content = await res.json();
            if (!content) return;

            const { texts, styles, images } = content;

            // 1. Aplicar Estilos y Tipografías
            if (styles) {
                const root = document.documentElement;

                // Cargar Google Fonts dinámicamente si cambian
                if (styles.font_heading || styles.font_body) {
                    const fh = encodeURIComponent(styles.font_heading || 'Outfit');
                    const fb = encodeURIComponent(styles.font_body || 'Inter');
                    const fontLink = document.getElementById('google-fonts-link');
                    if (fontLink) {
                        fontLink.href = `https://fonts.googleapis.com/css2?family=${fh}:wght@300;400;600;800&family=${fb}:wght@300;400;500;700&display=swap`;
                    }
                    if (styles.font_heading) root.style.setProperty('--font-heading', `'${styles.font_heading}', sans-serif`);
                    if (styles.font_body)    root.style.setProperty('--font-body', `'${styles.font_body}', sans-serif`);
                }

                // Tamaños
                if (styles.hero_title_size) root.style.setProperty('--hero-title-size', styles.hero_title_size);
                if (styles.h2_size)         root.style.setProperty('--h2-size', styles.h2_size);
                if (styles.body_font_size)  root.style.setProperty('--body-font-size', styles.body_font_size);

                // Colores
                if (styles.color_primary)      root.style.setProperty('--primary', styles.color_primary);
                if (styles.color_primary_dark) root.style.setProperty('--primary-dark', styles.color_primary_dark);
                if (styles.color_accent)       root.style.setProperty('--accent-1', styles.color_accent);
                if (styles.color_bg)           root.style.setProperty('--bg-light', styles.color_bg);
            }

            // 2. Aplicar Imágenes del Sitio
            if (images) {
                if (images.logo) {
                    const siteLogo = document.getElementById('site-logo');
                    const footerLogo = document.getElementById('cms-footer-logo');
                    if (siteLogo) siteLogo.src = images.logo;
                    if (footerLogo) footerLogo.src = images.logo;
                }
                const validSlider = (images.hero_slider && Array.isArray(images.hero_slider))
                    ? images.hero_slider.map(safeMediaUrl).filter(Boolean)
                    : [];

                const heroSlider = document.getElementById('hero-slider');
                const cmsHeroBg = document.getElementById('cms-hero-bg');

                if (validSlider.length > 0) {
                    if (cmsHeroBg) {
                        cmsHeroBg.style.backgroundImage = `url('${validSlider[0]}')`;
                    }
                    if (heroSlider) {
                        // Limpiar slides viejos adicionales
                        Array.from(heroSlider.children).forEach(child => {
                            if (child !== cmsHeroBg) child.remove();
                        });
                        
                        // Añadir los siguientes slides a partir del índice 1
                        validSlider.slice(1).forEach((imgSrc) => {
                            const slide = document.createElement('div');
                            slide.className = 'hero-bg slide';
                            slide.style.backgroundImage = `url('${imgSrc}')`;
                            heroSlider.appendChild(slide);
                        });

                        if (window.heroSliderInterval) clearInterval(window.heroSliderInterval);
                        const slides = heroSlider.querySelectorAll('.slide');
                        let currentSlide = 0;
                        if (slides.length > 1) {
                            window.heroSliderInterval = setInterval(() => {
                                slides[currentSlide].classList.remove('active');
                                currentSlide = (currentSlide + 1) % slides.length;
                                slides[currentSlide].classList.add('active');
                            }, 4000);
                        }
                    }
                } else if (images.hero_bg && cmsHeroBg) {
                    cmsHeroBg.style.backgroundImage = `url('${images.hero_bg}')`;
                }
                if (images.about_image) {
                    const aboutImg = document.getElementById('cms-about-image');
                    if (aboutImg) aboutImg.src = images.about_image;
                }
                if (images.director_image) {
                    const directorImg = document.getElementById('cms-director-image');
                    const directorIcon = document.getElementById('cms-director-icon');
                    if (directorImg && directorIcon) {
                        directorImg.src = images.director_image;
                        directorImg.style.display = 'block';
                        directorIcon.style.display = 'none';
                    }
                }
                if (images.cta_bg) {
                    const ctaBg = document.getElementById('cms-cta-bg');
                    if (ctaBg) ctaBg.style.backgroundImage = `url('${images.cta_bg}')`;
                }

                if (images.clients_logos && Array.isArray(images.clients_logos) && images.clients_logos.length > 0) {
                    const clientsSection = document.getElementById('clientes-section');
                    const clientsTrack = document.getElementById('cms-clients-track');
                    const clientsTitle = clientsSection ? clientsSection.querySelector('h2') : null;
                    if (clientsSection && clientsTrack) {
                        clientsSection.style.display = 'block';
                        clientsTrack.innerHTML = '';

                        // Aplicar configuraciones de estilo del carrusel
                        const cc = content.clients_carousel || {};
                        if (cc.bg_color)     document.documentElement.style.setProperty('--clients-bg', cc.bg_color);
                        if (cc.title_color)  document.documentElement.style.setProperty('--clients-title-color', cc.title_color);
                        if (cc.title_size)   document.documentElement.style.setProperty('--clients-title-size', cc.title_size);
                        if (cc.logo_height)  document.documentElement.style.setProperty('--clients-logo-height', cc.logo_height);
                        if (cc.speed)        document.documentElement.style.setProperty('--clients-speed', cc.speed + 's');
                        if (cc.gap)          document.documentElement.style.setProperty('--clients-gap', cc.gap);
                        if (cc.padding)      document.documentElement.style.setProperty('--clients-padding', cc.padding);

                        // Filtro de color según modo
                        const colorMode = cc.logo_color_mode || 'grayscale';
                        if (colorMode === 'color')     document.documentElement.style.setProperty('--clients-logo-filter', 'grayscale(0%) opacity(1)');
                        else if (colorMode === 'mix')  document.documentElement.style.setProperty('--clients-logo-filter', 'grayscale(40%) opacity(0.85)');
                        else                           document.documentElement.style.setProperty('--clients-logo-filter', 'grayscale(100%) opacity(0.7)');

                        // Título personalizable
                        if (clientsTitle && cc.title !== undefined) clientsTitle.textContent = cc.title || 'Nuestros Clientes';
                        
                        let logosToRender = images.clients_logos.map(safeMediaUrl).filter(Boolean);
                        // Multiplicar logos si son muy pocos para que cubran toda la pantalla
                        if (logosToRender.length > 0) {
                            while (logosToRender.length < 12) {
                                logosToRender = logosToRender.concat(images.clients_logos);
                            }
                        }

                        // Render logos in two inner wrappers for seamless marquee
                        const renderInner = () => {
                            const inner = document.createElement('div');
                            inner.className = 'clients-track-inner';
                            logosToRender.forEach(logoUrl => {
                                const img = document.createElement('img');
                                img.src = logoUrl;
                                img.className = 'client-logo';
                                img.alt = 'Cliente';
                                inner.appendChild(img);
                            });
                            clientsTrack.appendChild(inner);
                        };
                        
                        renderInner();
                        renderInner(); // Segundo bloque para el scroll infinito
                    }
                }
            }

            // 3. Aplicar Textos del Sitio
            if (texts) {
                // Guardar textos de botones para el toggle
                if (texts.btn_ver_mas) cmsTexts.btn_ver_mas = texts.btn_ver_mas;
                if (texts.btn_ver_menos) cmsTexts.btn_ver_menos = texts.btn_ver_menos;

                const setHtml = (id, html) => {
                    const el = document.getElementById(id);
                    if (el && html !== undefined) el.innerHTML = sanitizeCmsHtml(html);
                };
                const setText = (id, txt) => {
                    const el = document.getElementById(id);
                    if (el && txt !== undefined) el.textContent = txt;
                };

                // Hero
                setText('cms-hero-label', texts.hero_label);
                setHtml('cms-hero-title', texts.hero_title);
                setText('cms-hero-desc', texts.hero_desc);
                setText('cms-hero-btn-projects', texts.hero_btn_projects);
                setText('cms-hero-btn-contact', texts.hero_btn_contact);

                // Stats
                setText('cms-stat-1-num', texts.stats_years_num);
                setText('cms-stat-1-lbl', texts.stats_years_lbl);
                setText('cms-stat-2-num', texts.stats_projects_num);
                setText('cms-stat-2-lbl', texts.stats_projects_lbl);
                setText('cms-stat-3-num', texts.stats_clients_num);
                setText('cms-stat-3-lbl', texts.stats_clients_lbl);


                // Servicios
                setText('cms-services-title', texts.services_title);
                setText('cms-services-subtitle', texts.services_subtitle);

                const renderServiceItems = (listId, itemsText) => {
                    const ul = document.getElementById(listId);
                    if (ul && itemsText) {
                        const items = itemsText.split('\n').filter(i => i.trim());
                        ul.innerHTML = items.map(item => `<li><i data-lucide="check"></i> ${escapeHtml(item.trim())}</li>`).join('');
                    }
                };
                setText('cms-service-1-title', texts.service_1_title);
                setText('cms-service-1-desc', texts.service_1_desc);
                renderServiceItems('cms-service-1-items', texts.service_1_items);

                setText('cms-service-2-title', texts.service_2_title);
                setText('cms-service-2-desc', texts.service_2_desc);
                renderServiceItems('cms-service-2-items', texts.service_2_items);

                setText('cms-service-3-title', texts.service_3_title);
                setText('cms-service-3-desc', texts.service_3_desc);
                renderServiceItems('cms-service-3-items', texts.service_3_items);

                // Nosotros
                setText('cms-about-badge', texts.about_badge);
                setText('cms-about-title', texts.about_title);
                setHtml('cms-about-p1', texts.about_p1);
                setText('cms-about-p2', texts.about_p2);
                setText('cms-director-role', texts.about_director_role);
                setText('cms-director-name', texts.about_director_name);
                setText('cms-director-desc', texts.about_director_desc);
                setText('cms-exp-years', texts.about_exp_years);
                setHtml('cms-exp-text', texts.about_exp_text);

                // Proyectos Títulos
                setText('cms-projects-title', texts.projects_title);
                setText('cms-projects-subtitle', texts.projects_subtitle);
                if (btnText && !btnVerMas?.getAttribute('aria-expanded') === 'true') {
                    btnText.textContent = texts.btn_ver_mas || 'Ver más proyectos';
                }

                // CTA
                setText('cms-cta-title', texts.cta_title);
                setText('cms-cta-subtitle', texts.cta_subtitle);
                setText('cms-cta-btn-wsp', texts.cta_btn_wsp);
                setText('cms-cta-btn-ig', texts.cta_btn_ig);

                // Footer & Contacto
                setText('cms-footer-desc', texts.footer_desc);
                setText('cms-contact-address', texts.contact_address);
                setText('cms-contact-phone', texts.contact_phone);
                setText('cms-contact-email', texts.contact_email);
                setText('cms-contact-instagram', texts.contact_instagram);
                setHtml('cms-footer-copy', texts.footer_copy);

                // Enlaces dinámicos
                if (texts.contact_wsp_link) {
                    ['btn-wsp-header', 'cms-hero-btn-contact-link', 'cms-cta-btn-wsp-link', 'cms-footer-wsp-link', 'cms-wsp-float', 'cms-contact-phone-link'].forEach(id => {
                        const el = document.getElementById(id);
                        if (el) {
                            const safeUrl = safeHttpUrl(texts.contact_wsp_link);
                            if (safeUrl) el.href = safeUrl;
                        }
                    });
                }
                if (texts.contact_instagram) {
                    const igCandidate = texts.contact_instagram.startsWith('http')
                        ? texts.contact_instagram
                        : `https://www.instagram.com/${texts.contact_instagram.replace('@', '')}/`;
                    const igUrl = safeHttpUrl(igCandidate);
                    ['cms-cta-btn-ig-link', 'cms-footer-ig-link', 'cms-contact-ig-link'].forEach(id => {
                        const el = document.getElementById(id);
                        if (el && igUrl) el.href = igUrl;
                    });
                }
                if (texts.contact_email) {
                    const mailLink = document.getElementById('cms-contact-email-link');
                    if (mailLink) mailLink.href = `mailto:${texts.contact_email}`;
                }

                safeCreateIcons();
            }

            // 4. Aplicar Video Promocional (Carousel)
            let videoUrls = content.video ? (content.video.urls || []) : [];
            if (content.video && content.video.src && videoUrls.length === 0) {
                videoUrls = [content.video.src];
            }
            videoUrls = videoUrls.map(safeMediaUrl).filter(Boolean);

            const videoSec = document.getElementById('video-institucional');
            if (videoSec) {
                if (videoUrls.length > 0) {
                    videoSec.style.display = 'block';
                    const vTitle = document.getElementById('cms-video-title');
                    const vDesc = document.getElementById('cms-video-desc');
                    const swiperWrapper = document.getElementById('video-swiper-wrapper');
                    
                    if (vTitle && content.video.title) vTitle.textContent = content.video.title;
                    if (vDesc && content.video.description) vDesc.textContent = content.video.description;
                    
                    if (swiperWrapper) {
                        swiperWrapper.innerHTML = '';
                        
                        videoUrls.forEach((src, index) => {
                            const slide = document.createElement('div');
                            slide.className = 'swiper-slide';
                            slide.style.display = 'flex';
                            slide.style.justifyContent = 'center';
                            slide.style.alignItems = 'center';
                            slide.style.width = '100%';

                            const isUploadedImage = src.match(/\.(jpeg|jpg|jfif|gif|png|webp|avif|bmp|svg)$/i);
                            const isUploadedVideo = src.match(/\.(mp4|mov|webm)$/i);

                            if (src.includes('youtube.com') || src.includes('youtu.be')) {
                                let embedUrl = src;
                                if (src.includes('watch?v=')) embedUrl = src.replace('watch?v=', 'embed/');
                                else if (src.includes('youtu.be/')) embedUrl = src.replace('youtu.be/', 'youtube.com/embed/');
                                
                                slide.innerHTML = `<iframe src="${escapeHtml(embedUrl)}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen style="width:100%; max-width:800px; aspect-ratio:16/9;"></iframe>`;
                            } else if (src.includes('instagram.com')) {
                                let permalink = src.split('?')[0];
                                if (!permalink.endsWith('/')) permalink += '/';
                                
                                slide.innerHTML = `
                                    <blockquote class="instagram-media" data-instgrm-permalink="${escapeHtml(permalink)}?utm_source=ig_embed&amp;utm_campaign=loading" data-instgrm-version="14" style=" background:#FFF; border:0; border-radius:3px; box-shadow:0 0 1px 0 rgba(0,0,0,0.5),0 1px 10px 0 rgba(0,0,0,0.15); margin: 1px; max-width:540px; min-width:326px; padding:0; width:99.375%; width:-webkit-calc(100% - 2px); width:calc(100% - 2px);">
                                    </blockquote>
                                `;
                            } else if (isUploadedImage) {
                                slide.innerHTML = `<img src="${escapeHtml(src)}" alt="Publicación" class="post-media" style="box-shadow: 0 10px 30px rgba(0,0,0,0.1);">`;
                            } else if (isUploadedVideo) {
                                slide.innerHTML = `<video class="plyr-video post-media" src="${escapeHtml(src)}" playsinline controls></video>`;
                            } else {
                                slide.innerHTML = buildLinkCard(src);
                            }
                            
                            swiperWrapper.appendChild(slide);
                        });

                        // Inicializar Swiper de Video
                        if (window.videoSwiperInstance) {
                            window.videoSwiperInstance.destroy(true, true);
                        }
                        
                        // Wait a tick for DOM to update
                        setTimeout(() => {
                            if (typeof Swiper !== 'undefined') {
                                window.videoSwiperInstance = new Swiper('.video-swiper', {
                                    slidesPerView: 1,
                                    spaceBetween: 30,
                                    loop: false,
                                    autoHeight: true,
                                    observer: true,
                                    observeParents: true,
                                    navigation: {
                                        nextEl: '.video-swiper .swiper-button-next',
                                        prevEl: '.video-swiper .swiper-button-prev',
                                    },
                                    grabCursor: true
                                });
                            }

                            // Inicializar Plyr
                            if (typeof Plyr !== 'undefined') {
                                document.querySelectorAll('.plyr-video').forEach(vid => {
                                    new Plyr(vid, {
                                        controls: ['play-large', 'play', 'progress', 'current-time', 'mute', 'volume', 'fullscreen']
                                    });
                                });
                            }

                            // ── Carga dinámica de SDKs sociales ──────────────
                            const hasIG = swiperWrapper.querySelector('.instagram-media');
                            function refreshSwiperHeight() {
                                [100, 500, 1500, 3000].forEach(d => {
                                    setTimeout(() => {
                                        if (window.videoSwiperInstance) {
                                            window.videoSwiperInstance.updateAutoHeight();
                                        }
                                    }, d);
                                });
                            }

                            if (hasIG) {
                                if (window.instgrm && window.instgrm.Embeds) {
                                    window.instgrm.Embeds.process();
                                    refreshSwiperHeight();
                                } else {
                                    const s = document.createElement('script');
                                    s.src = 'https://www.instagram.com/embed.js';
                                    s.async = true;
                                    s.onload = () => {
                                        if (window.instgrm && window.instgrm.Embeds) {
                                            window.instgrm.Embeds.process();
                                            refreshSwiperHeight();
                                        }
                                    };
                                    document.body.appendChild(s);
                                }
                            } else {
                                refreshSwiperHeight();
                            }
                        }, 50);
                    }
                } else {
                    videoSec.style.display = 'none';
                }
            }
            
        } catch (e) {
            console.error('Error cargando contenidos del CMS:', e);
        }
    }

    // ── Cargar Proyectos Dinámicos desde API ─────────────────────────────────
    async function loadDynamicProjects() {
        const gridMain  = document.getElementById('projects-grid');
        if (!gridMain) return;

        try {
            const res = await fetch('/api/projects');
            if (!res.ok) return;
            const projects = await res.json();
            if (!Array.isArray(projects) || projects.length === 0) return;

            window.__nadProjectsById = {};
            projects.forEach(p => {
                if (p && p.id) window.__nadProjectsById[p.id] = p;
            });

            // Separar entre Destacados y Adicionales
            let featured = [];
            let extra    = [];

            const hasFeaturedField = projects.some(p => p.featured !== undefined);
            if (hasFeaturedField) {
                featured = projects.filter(p => p.featured === 1);
                extra    = projects.filter(p => p.featured === 0);
                if (featured.length === 0 && projects.length > 0) {
                    featured = projects.slice(0, 3);
                    extra    = projects.slice(3);
                }
            } else {
                featured = projects.slice(0, 3);
                extra    = projects.slice(3);
            }

            // Slider de Hero se movió a loadSiteContent() para usar imágenes del sitio

            // Generador de HTML de tarjeta con soporte de video y lazy loading
            function createCardHtml(p, idx, isExtra = false) {
                const isVideo = /\.(mp4|webm|mov)$/i.test(p.image);
                const mediaElement = isVideo
                    ? `<video src="${p.image}" muted loop playsinline onmouseover="this.play()" onmouseout="this.pause()" style="width:100%;height:100%;object-fit:cover;"></video>`
                    : `<img src="${p.image}" alt="${escapeHtml(p.title)}" onerror="this.src='/nad.png'" loading="lazy" decoding="async">`;

                return `
                <div class="project-card ${isExtra ? 'project-extra-card' : 'fade-up delay-' + ((idx % 3) + 1)} visible" data-year="${p.year}">
                    <div class="project-image">
                        ${mediaElement}
                        <div class="project-overlay">
                            <button class="project-link open-modal-btn"
                                data-id="${p.id}"
                                data-title="${escapeHtml(p.title)}"
                                data-category="${escapeHtml(p.category)}"
                                data-desc="${escapeHtml((p.description || '').replace(/\r\n|\r|\n/g, '&#10;'))}"
                                data-location="${escapeHtml(p.location)}"
                                data-year="${p.year}"
                                data-image="${p.image}"
                                aria-label="Ver detalles del proyecto ${escapeHtml(p.title)}">
                                <i data-lucide="arrow-up-right"></i>
                            </button>
                        </div>
                    </div>
                    <div class="project-info">
                        <span class="project-year-tag">${p.year}</span>
                        <h3>${escapeHtml(p.title)}</h3>
                        <p>${escapeHtml(p.category)}</p>
                    </div>
                </div>`;
            }

            // Renderizar en el DOM
            gridMain.innerHTML  = featured.map((p, i) => createCardHtml(p, i, false)).join('');

            // Re-vincular eventos a las nuevas tarjetas
            bindTiltEffect(gridMain);
            bindModalButtons(gridMain);
            observeFadeUpElements();
            safeCreateIcons();

        } catch (e) {
            console.error('Error cargando proyectos dinámicos:', e);
        }
    }

    // Ejecutar hidratación inicial
    loadSiteContent();
    loadDynamicProjects();

});

// SEO: Handle back/forward buttons
window.addEventListener('popstate', (e) => {
    const modal = document.getElementById('project-modal');
    if (e.state && e.state.projectId) {
        // Intentar abrir el modal del proyecto correspondiente
        const btn = document.querySelector(`.open-modal-btn[data-id="${e.state.projectId}"]`);
        if (btn) btn.click();
    } else {
        // Cerrar modal si se vuelve atrás
        if (modal && modal.classList.contains('active')) {
            modal.classList.remove('active');
            modal.setAttribute('aria-hidden', 'true');
            document.body.style.overflow = '';
            setTimeout(() => { modal.style.display = 'none'; }, 400);
        }
    }
});

// SEO: Auto-open if URL has /proyecto/:id
// La página /proyecto/:id ya se renderiza con meta tags correctos desde el servidor.
// No se necesita lógica extra del lado del cliente porque el servidor
// sirve index.html con los meta tags del proyecto inyectados.
