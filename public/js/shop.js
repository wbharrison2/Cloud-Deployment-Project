// Shop page
var shopState = { category: '', search: '', sort: 'name', page: 1 };

async function initShop() {
  shopState.page = 1;
  await Promise.all([loadCategories(), loadShopProducts()]);
  setupShopControls();
}

async function loadCategories() {
  try {
    var res = await fetchAPI('/api/products/categories');
    var cats = res.categories || res;
    var container = document.getElementById('category-filters');
    if (!container) return;
    container.innerHTML = '<button class="cat-btn active" onclick="filterByCategory(this,\'\')" >All</button>' +
      cats.map(function(c) { return '<button class="cat-btn" onclick="filterByCategory(this,\'' + c + '\')">' + c + '</button>'; }).join('');
  } catch(e) {}
}

async function loadShopProducts() {
  var grid = document.getElementById('product-grid');
  if (!grid) return;
  grid.innerHTML = '<p class="text-muted">Loading...</p>';
  var loc = getLocation();
  var params = new URLSearchParams({ page: shopState.page, limit: 12, location: loc });
  if (shopState.category) params.set('category', shopState.category);
  if (shopState.search)   params.set('search',   shopState.search);
  if (shopState.sort)     params.set('sort',      shopState.sort);
  try {
    var res = await fetchAPI('/api/products?' + params.toString());
    var products = res.products || res;
    var meta = res.meta;
    grid.innerHTML = products.length
      ? products.map(renderProductCard).join('')
      : '<p class="text-muted" style="grid-column:1/-1">No products found.</p>';
    if (meta) renderShopPagination(meta);
  } catch(e) { grid.innerHTML = '<p class="text-muted" style="grid-column:1/-1">Failed to load products.</p>'; }
}

function filterByCategory(btn, cat) {
  document.querySelectorAll('.cat-btn').forEach(function(b) { b.classList.remove('active'); });
  btn.classList.add('active');
  shopState.category = cat; shopState.page = 1;
  loadShopProducts();
}

function setupShopControls() {
  var search = document.getElementById('search-input');
  var sort   = document.getElementById('sort-select');
  if (search) {
    var timer;
    search.addEventListener('input', function(e) {
      clearTimeout(timer);
      timer = setTimeout(function() { shopState.search = e.target.value.trim(); shopState.page = 1; loadShopProducts(); }, 300);
    });
  }
  if (sort) sort.addEventListener('change', function(e) { shopState.sort = e.target.value; loadShopProducts(); });
}

function renderShopPagination(meta) {
  var c = document.getElementById('pagination');
  if (!c || meta.total_pages <= 1) return;
  var html = '';
  if (meta.page > 1)             html += '<button class="btn btn-outline" onclick="changePage(' + (meta.page-1) + ')">Previous</button> ';
  html += '<span class="page-info">Page ' + meta.page + ' of ' + meta.total_pages + '</span>';
  if (meta.page < meta.total_pages) html += ' <button class="btn btn-outline" onclick="changePage(' + (meta.page+1) + ')">Next</button>';
  c.innerHTML = html;
}

function changePage(p) { shopState.page = p; loadShopProducts(); window.scrollTo(0,0); }
