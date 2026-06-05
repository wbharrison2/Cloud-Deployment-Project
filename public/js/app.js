var AGW_CART_KEY = 'agw_cart';
var AGW_LOCATION_KEY = 'agw_location';

function getLocation() {
  return localStorage.getItem(AGW_LOCATION_KEY) || 'pdx';
}

function setLocation(loc) {
  localStorage.setItem(AGW_LOCATION_KEY, loc);
  updateLocationUI();
  // reload products if on pages that show them
  if (typeof loadShopProducts === 'function') loadShopProducts();
  if (typeof loadFeatured === 'function') loadFeatured();
  // toggle hero sections on index
  var heroPdx = document.getElementById('hero-pdx');
  var heroSea = document.getElementById('hero-sea');
  if (heroPdx && heroSea) {
    heroPdx.style.display = loc === 'sea' ? 'none' : 'block';
    heroSea.style.display = loc === 'sea' ? 'block' : 'none';
  }
}

function updateLocationUI() {
  var loc = getLocation();
  var pdxBtn = document.getElementById('loc-pdx');
  var seaBtn = document.getElementById('loc-sea');
  var badge = document.getElementById('header-location');
  if (pdxBtn) pdxBtn.classList.toggle('active', loc === 'pdx');
  if (seaBtn) seaBtn.classList.toggle('active', loc === 'sea');
  if (badge) badge.textContent = loc === 'sea' ? 'Seattle' : 'Portland';
  // shop description
  var desc = document.getElementById('shop-location-desc');
  if (desc) desc.textContent = 'Showing ' + (loc === 'sea' ? 'Seattle' : 'Portland') + ' collection (shared + exclusive pieces).';
}

async function fetchAPI(url, options) {
  options = options || {};
  try {
    var res = await fetch(url, Object.assign({ credentials: 'include' }, options));
    var cacheHeader = res.headers.get('X-Cache');
    var data = await res.json();
    if (cacheHeader) {
      var ind = document.getElementById('cache-indicator');
      if (ind) ind.textContent = 'Cache: ' + cacheHeader;
    }
    if (res.status === 401 && !url.includes('/api/auth/')) {
      return null;
    }
    return data;
  } catch (e) {
    console.error('fetchAPI error', url, e);
    return null;
  }
}

function getCart() {
  try { return JSON.parse(localStorage.getItem(AGW_CART_KEY) || '[]'); }
  catch { return []; }
}

function saveCart(cart) {
  localStorage.setItem(AGW_CART_KEY, JSON.stringify(cart));
  updateCartCount();
}

function addToCart(product, qty) {
  qty = qty || 1;
  var cart = getCart();
  var idx = cart.findIndex(function(i) { return i.id === product.id; });
  if (idx >= 0) {
    cart[idx].quantity = Math.min(cart[idx].quantity + qty, product.stock);
  } else {
    cart.push({ id: product.id, slug: product.slug, name: product.name, price: product.price, quantity: qty, stock: product.stock, image_url: product.image_url });
  }
  saveCart(cart);
}

function clearCart() {
  localStorage.removeItem(AGW_CART_KEY);
  updateCartCount();
}

function updateCartCount() {
  var cart = getCart();
  var count = cart.reduce(function(sum, i) { return sum + i.quantity; }, 0);
  var els = document.querySelectorAll('#cart-count');
  els.forEach(function(el) { el.textContent = count; });
}

function formatPrice(cents) {
  return '$' + (cents / 100).toFixed(2);
}

function renderProductCard(product) {
  var storeTag = '';
  if (product.store_slug === 'pdx') storeTag = '<span class="store-tag tag-pdx">PDX Exclusive</span>';
  else if (product.store_slug === 'sea') storeTag = '<span class="store-tag tag-sea">SEA Exclusive</span>';
  else storeTag = '<span class="store-tag tag-shared">All Locations</span>';
  return (
    '<div class="product-card">' +
    (product.image_url
      ? '<img class="product-img" src="' + product.image_url + '" alt="' + product.name + '" onerror="this.style.display=\'none\'" loading="lazy">'
      : '<div class="product-img-placeholder">No image</div>') +
    '<div class="product-body">' +
    storeTag +
    '<div class="product-name">' + product.name + '</div>' +
    '<div class="product-price">' + formatPrice(product.price) + '</div>' +
    '<div class="product-desc">' + (product.description || '') + '</div>' +
    '<a href="/product.html?slug=' + product.slug + '" class="btn btn-outline" style="width:100%;text-align:center;font-size:.85rem">View Details</a>' +
    '</div></div>'
  );
}

document.addEventListener('DOMContentLoaded', function() {
  updateCartCount();
});
