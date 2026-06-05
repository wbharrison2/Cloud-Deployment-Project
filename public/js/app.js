// Artisan Gem Works P4 - shared utilities with location management

var AGW_LOCATION_KEY = 'agw_location';

function getLocation() {
  return localStorage.getItem(AGW_LOCATION_KEY) || 'pdx';
}

function setLocation(loc) {
  localStorage.setItem(AGW_LOCATION_KEY, loc);
  // Update any visible loc-btns
  document.querySelectorAll('.loc-btn').forEach(function(b) {
    b.classList.toggle('active', b.id === 'loc-' + loc);
  });
  var badge = document.getElementById('header-location');
  if (badge) badge.textContent = loc === 'sea' ? 'Seattle' : 'Portland';
  // Trigger reload if on shop page
  if (typeof loadShopProducts === 'function') loadShopProducts();
  if (typeof loadFeaturedProducts === 'function') loadFeaturedProducts();
  if (typeof updateLocationDisplay === 'function') updateLocationDisplay(loc);
}

async function fetchAPI(url, options) {
  options = options || {};
  var res = await fetch(url, Object.assign({ credentials: 'include' }, options));
  var cacheHeader = res.headers.get('X-Cache');
  if (cacheHeader) showCdnIndicator(cacheHeader);
  if (res.status === 401) {
    var data = await res.json().catch(function() { return {}; });
    var err = new Error(data.error || 'Unauthorized');
    err.status = 401;
    throw err;
  }
  if (!res.ok) {
    var data = await res.json().catch(function() { return {}; });
    throw new Error(data.error || 'Request failed (' + res.status + ')');
  }
  return res.json();
}

function formatPrice(cents) {
  return '$' + (cents / 100).toFixed(2);
}

function updateCartCount() {
  var count = getCart().reduce(function(s, i) { return s + i.quantity; }, 0);
  document.querySelectorAll('#cart-count').forEach(function(el) { el.textContent = count; });
}

function getCart() {
  try { return JSON.parse(localStorage.getItem('agw_cart') || '[]'); } catch(e) { return []; }
}

function saveCart(cart) { localStorage.setItem('agw_cart', JSON.stringify(cart)); }

function addToCart(product, qty) {
  qty = qty || 1;
  var cart = getCart();
  var existing = cart.find(function(i) { return i.id === product.id; });
  if (existing) { existing.quantity = Math.min(10, existing.quantity + qty); }
  else { cart.push({ id: product.id, slug: product.slug, name: product.name, price: product.price, quantity: qty }); }
  saveCart(cart);
  updateCartCount();
}

function clearCart() { localStorage.removeItem('agw_cart'); updateCartCount(); }

function showCdnIndicator(status) {
  var el = document.getElementById('cache-indicator');
  if (!el) return;
  var hit = status && status.toUpperCase().includes('HIT');
  el.textContent = hit ? 'Served from cache' : 'Live from server';
  el.className = 'cache-indicator ' + (hit ? 'cache-hit' : 'cache-miss');
}

function renderProductCard(product) {
  var safeP = JSON.stringify(product).replace(/"/g, '&quot;');
  var storeTag = product.store_slug
    ? '<span class="store-tag tag-' + product.store_slug + '">' + (product.store_slug === 'pdx' ? 'PDX' : 'SEA') + '</span>'
    : '';
  return '<article class="product-card">' +
    '<a href="/product.html?slug=' + product.slug + '" class="product-card-link">' +
      '<div class="product-card-image"><div class="img-placeholder">' + (product.category || 'Jewelry') + '</div></div>' +
      '<div class="product-card-body">' +
        '<h3 class="product-card-name">' + product.name + storeTag + '</h3>' +
        '<p class="product-card-price">' + formatPrice(product.price) + '</p>' +
      '</div>' +
    '</a>' +
    '<button class="btn btn-outline btn-sm product-card-add" onclick="addToCart(' + safeP + ', 1); updateCartCount();">Add to Cart</button>' +
  '</article>';
}
