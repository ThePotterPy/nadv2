// Archivo JS para la página de Proyectos

document.addEventListener('DOMContentLoaded', () => {
    safeCreateIcons();
    loadSiteContent();
    loadAndRenderProjects();

    document.querySelectorAll('[data-project-filter]').forEach((button) => {
        button.addEventListener('click', () => filterProjectsView(button.dataset.projectFilter, button));
    });
    document.querySelectorAll('[data-view-mode]').forEach((button) => {
        button.addEventListener('click', () => setViewMode(button.dataset.viewMode, button));
    });
    
    // Esta página no tiene foto de hero: el header arranca sólido (clase
    // "scrolled" fija en el HTML) y debe quedarse así siempre. A diferencia
    // del home, acá no hay que sacarle la clase al volver arriba del todo.

    // En móvil el header ocupa mucho lugar: se esconde al bajar y reaparece
    // al subir, pero recién después de pasar HIDE_THRESHOLD.
    const header = document.querySelector('header');
    let lastScrollY = window.scrollY;
    const HIDE_THRESHOLD = 160;

    window.addEventListener('scroll', () => {
        const scrollTop = window.scrollY;
        if (header && window.innerWidth <= 768) {
            if (scrollTop > lastScrollY && scrollTop > HIDE_THRESHOLD) {
                header.classList.add('header-hidden');
            } else if (scrollTop < lastScrollY) {
                header.classList.remove('header-hidden');
            }
        }
        lastScrollY = scrollTop;
    });

    const mobileMenuBtn = document.getElementById('mobile-menu-btn');
    const mobileNav = document.getElementById('mobile-nav');
    let menuOpen = false;
    if (mobileMenuBtn) {
        mobileMenuBtn.setAttribute('aria-expanded', 'false');
        mobileMenuBtn.setAttribute('aria-controls', 'mobile-nav');
        mobileMenuBtn.addEventListener('click', () => {
            menuOpen = !menuOpen;
            mobileNav.classList.toggle('open', menuOpen);
            mobileMenuBtn.setAttribute('aria-expanded', String(menuOpen));
            mobileMenuBtn.setAttribute('aria-label', menuOpen ? 'Cerrar menú' : 'Abrir menú');
            mobileMenuBtn.innerHTML = menuOpen ? '<i data-lucide="x"></i>' : '<i data-lucide="menu"></i>';
            safeCreateIcons();
        });
    }
});

function safeCreateIcons() {
    try {
        if (typeof lucide !== 'undefined' && lucide && typeof lucide.createIcons === 'function') {
            lucide.createIcons();
        }
    } catch (e) {}
}

async function loadSiteContent() {
    try {
        const res = await fetch('/api/content');
        if (!res.ok) return;
        const data = await res.json();
        
        // Aplicar estilos
        if (data.styles) {
            const root = document.documentElement;
            const s = data.styles;
            if (s.font_heading) {
                if (s.font_heading === 'MADE TOMMY') {
                    root.style.setProperty('--font-heading', '"MADE TOMMY", sans-serif');
                } else {
                    root.style.setProperty('--font-heading', `"${s.font_heading}", sans-serif`);
                }
            }
            if (s.font_body) root.style.setProperty('--font-body', `"${s.font_body}", sans-serif`);
            
            if (s.color_primary) root.style.setProperty('--primary', s.color_primary);
            if (s.color_primary_dark) root.style.setProperty('--primary-dark', s.color_primary_dark);
            if (s.color_accent) root.style.setProperty('--accent', s.color_accent);
            if (s.color_bg) root.style.setProperty('--bg-light', s.color_bg);
        }
        
        // Logo
        if (data.images && data.images.logo) {
            const logo = document.getElementById('site-logo');
            const fLogo = document.getElementById('cms-footer-logo');
            if (logo) logo.src = data.images.logo;
            if (fLogo) fLogo.src = data.images.logo;
        }
    } catch (e) {
        console.error("Error cargando content:", e);
    }
}

let loadedProjects = [];

async function loadAndRenderProjects() {
    try {
        const res = await fetch('/api/projects');
        if (!res.ok) throw new Error('Error en fetch: ' + res.status);
        let projects = await res.json();
        
        // Filtrar solo los visibles
        loadedProjects = Array.isArray(projects) ? projects.filter(p => p.visible === 1) : [];
        
        // Iniciar con 'todos' como pidió el usuario
        const defaultFilter = 'todos';

        // Actualizar botón activo en el header de filtros
        document.querySelectorAll('.filter-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.projectFilter === defaultFilter);
        });

        renderProjectsList(defaultFilter);
    } catch(e) {
        console.error('Error cargando proyectos:', e);
        const container = document.getElementById('projects-container');
        if (container) {
            container.innerHTML = `<div style="text-align:center;padding:3rem 1rem;color:#dc2626;">
                <i data-lucide="alert-circle" style="width:36px;height:36px;margin:0 auto 1rem;"></i>
                <h3 style="margin-bottom:0.5rem;">Error al cargar los proyectos</h3>
                <p style="color:#6b7280;font-size:0.95rem;">Por favor, recargá la página o intentá nuevamente en unos momentos.</p>
            </div>`;
            safeCreateIcons();
        }
    }
}

function filterProjectsView(type, btn) {
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    renderProjectsList(type);
}

function setViewMode(mode, btn) {
    document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    
    const container = document.getElementById('projects-container');
    if (mode === 'grid') {
        container.classList.add('view-mode-grid');
    } else {
        container.classList.remove('view-mode-grid');
    }
    
    // Forzar evento de resize para que Swiper actualice sus dimensiones
    setTimeout(() => {
        window.dispatchEvent(new Event('resize'));
    }, 100);
}

function renderProjectsList(filterType) {
    const container = document.getElementById('projects-container');
    if (!container) return;
    
    let filtered = loadedProjects;
    if (filterType === 'destacados') {
        filtered = loadedProjects.filter(p => p.featured === 1);
    }

    if (filtered.length === 0) {
        let msg = 'No se encontraron proyectos en esta categoría por el momento. Te invitamos a revisar más adelante.';
        if (filterType === 'destacados') msg = 'No hay proyectos marcados como destacados en este momento.';

        container.innerHTML = `
            <div class="no-projects fade-up visible">
                <i data-lucide="folder-search"></i>
                <h3>Sin proyectos</h3>
                <p>${msg}</p>
            </div>`;
        safeCreateIcons();
        return;
    }

        let html = '';

        filtered.forEach((p, idx) => {
            // Determine if we flip the layout
            const isReverse = idx % 2 !== 0 ? 'reverse' : '';
            
            // Procesar media (portada + extras)
            const allMedia = getProjectMedia(p);

            // Generar Slides. Se probó diferir la carga con "lazy" para no
            // retrasar el LCP, pero dentro de este carrusel (posicionado con
            // absolute/relative dentro de un grid) daba fotos que no
            // terminaban de aparecer. Se carga todo directo: son pocas fotos
            // por proyecto, y que se vean bien pesa más que ese ahorro.
            let slidesHtml = '';
            allMedia.forEach((url) => {
                const isVideo = /\.(mp4|webm|mov)$/i.test(url);
                if (isVideo) {
                    slidesHtml += `<div class="swiper-slide"><video src="${escapeHtml(url)}" controls loop muted playsinline></video></div>`;
                } else {
                    slidesHtml += `<div class="swiper-slide"><img src="${escapeHtml(url)}" alt="${escapeHtml(p.title)}"></div>`;
                }
            });

            html += `
                <div class="project-block ${isReverse}">
                    <div class="project-media">
                        <div class="swiper project-swiper" id="swiper-proj-${p.id}">
                            <div class="swiper-wrapper">
                                ${slidesHtml}
                            </div>
                            ${allMedia.length > 1 ? `
                                <div class="swiper-pagination"></div>
                                <div class="swiper-button-prev"></div>
                                <div class="swiper-button-next"></div>
                            ` : ''}
                        </div>
                    </div>
                    <a class="project-info project-info-link" href="/proyecto/${p.id}">
                        <div class="project-meta">
                            <span class="meta-badge"><i data-lucide="tag" style="width:14px;height:14px;"></i> <span>${escapeHtml(p.category)}</span></span>
                            <span class="meta-badge"><i data-lucide="map-pin" style="width:14px;height:14px;"></i> <span>${escapeHtml(p.location)}</span></span>
                        </div>
                        <h2 class="project-title">${escapeHtml(p.title)}</h2>
                        <p class="project-desc">${escapeHtml(p.description)}</p>

                        <span class="btn btn-primary" style="align-self:flex-start;">
                            <i data-lucide="layout-grid"></i> <span>Ver proyecto completo</span>
                        </span>
                    </a>
                </div>
            `;
        });

        container.innerHTML = html;
        safeCreateIcons();

        // Inicializar Swipers de forma diferida para no bloquear el hilo principal
        setTimeout(() => {
            requestAnimationFrame(() => {
                filtered.forEach(p => {
                    const swiperEl = document.getElementById(`swiper-proj-${p.id}`);
                    const firstSlide = swiperEl?.querySelector('.swiper-slide');
                    if (swiperEl && firstSlide && firstSlide.nextElementSibling && typeof Swiper !== 'undefined') {
                        // loop:true duplica slides al vuelo para simular el ciclo infinito;
                        // combinado con contenido armado dinámicamente + autoplay, esa
                        // duplicación quedaba mal calculada (slide equivocado, solo se podía
                        // avanzar para un lado, "flasheaba" la foto correcta y después se
                        // veía otra). Sin loop, la navegación es simple: primera↔última foto,
                        // sin clones, sin ese desfasaje.
                        //
                        // OJO: acá había "observer/observeParents" + varios update() a
                        // destiempo para forzar el recálculo de tamaño. En este carrusel
                        // (dentro de un grid, con object-fit:cover) eso entraba en una
                        // realimentación: cada recálculo agrandaba un poco la medida, el
                        // observer detectaba el cambio y volvía a recalcular sobre el valor
                        // ya agrandado, hasta terminar en un ancho de slide de millones de
                        // píxeles (confirmado inspeccionando el DOM: swiper-slide con
                        // width:3.35544e+07px) — de ahí el color sólido, la imagen que
                        // "flasheaba" y desaparecía, y la navegación rota. Con una sola
                        // medición al crear el swiper (sin observer, sin update() extra)
                        // no hay bucle posible.
                        new Swiper(swiperEl, {
                            loop: false,
                            pagination: {
                                el: swiperEl.querySelector('.swiper-pagination'),
                                clickable: true
                            },
                            navigation: {
                                nextEl: swiperEl.querySelector('.swiper-button-next'),
                                prevEl: swiperEl.querySelector('.swiper-button-prev'),
                            },
                            autoplay: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? false : {
                                delay: 5000,
                                disableOnInteraction: true,
                            }
                        });
                    }
                });
            });
        }, 50);
}

// Junta la portada + medios extra de un proyecto en un solo array, sin
// duplicados. Antes esto estaba copiado dos veces (acá y en el modal) con
// un chequeo frágil (`extra_media.length > 2`, que asume que extra_media
// siempre es el string JSON "[]" cuando está vacío); ahora valida el array
// ya parseado, así funciona igual si extra_media llega como string o array.
function getProjectMedia(p) {
    let allMedia = [p.image];
    try {
        if (p.extra_media) {
            const extra = typeof p.extra_media === 'string' ? JSON.parse(p.extra_media) : p.extra_media;
            if (Array.isArray(extra) && extra.length > 0) {
                allMedia = allMedia.concat(extra);
            }
        }
    } catch (e) {}
    return [...new Set(allMedia)];
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
