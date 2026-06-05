var _currentCategory = null;
var _currentPage = 1;

function initShop() {
  loadCategories();
  loadShopProducts();
}

async function loadCategories() {
  var data = await fetchAPI('/api/products/categories');
  var list = document.getElementById('category-list');
  if (!list) return;
  var cats = Array.isArray(data) ? data : [];
  list.innerHTML = '<li><button onclick="filterByCategory(null)" class="' + (_currentCategory ? '' : 'active') + '">All</button></li>' +
    cats.map(function(c) {
      return '<li><button onclick="filterByCategory(\'' + c + '\')" class="' + (_currentCategory === c ? 'active' : '') + '">' + c + '</button></li>';
    }).join('');
}

async function loadShopProducts() {
  var grid = document.getElementById('product-grid');
  if (!grid) return;
  grid.innerHTML = '<div class="loading">Loading products…</div>';
  var search = (document.getElementById('search-input') || {}).value || '';
  var sort = (document.getElementById('sort-select') || {}).value || 'created_at';
  var loc = getLocation();
  var params = 'location=' + loc + '&page=' + _currentPage + '&limit=12&sort=' + sort;
  if (_currentCategory) params += '&category=' + encodeURIComponent(_currentCategory);
  if (search) params += '&search=' + encodeURIComponent(search);
  var data = await fetchAPI('/api/products?' + params);
  if (!data) { grid.innerHTML = '<p>Failed to load products.</p>'; return; }
  if (!data.products || !data.products.length) { grid.innerHTML = '<p>No products found.</p>'; return; }
  grid.innerHTML = data.products.map(renderProductCard).join('');
  renderShopPagination(data.total, data.limit);
}

function filterByCategory(cat) {
  _currentCategory = cat;
  _currentPage = 1;
  loadCategories();
  loadShopProducts();
}

function filterProducts() {
  _currentPage = 1;
  loadShopProducts();
}

function renderShopPagination(total, limit) {
  var totalPages = Math.ceil(total / limit);
  var pag = document.getElementById('pagination');
  if (!pag || totalPages <= 1) { if (pag) pag.innerHTML = ''; return; }
  var html = '';
  for (var i = 1; i <= totalPages; i++) {
    html += '<button onclick="changePage(' + i + ')" class="' + (_currentPage === i ? 'active' : '') + '">' + i + '</button>';
  }
  pag.innerHTML = html;
}

function changePage(p) {
  _currentPage = p;
  loadShopProducts();
  window.scrollTo(0, 0);
}
