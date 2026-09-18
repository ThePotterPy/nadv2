// Escapa texto para insertarlo seguro dentro de HTML (texto y atributos
// content="..."/src="..."). Un mismo archivo para servidor (server.js, vía
// require) y cliente (script.js/proyectos.js/admin, vía <script src=...>
// cargado antes) — antes esta misma función estaba copiada 4 veces.
function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = escapeHtml;
}
