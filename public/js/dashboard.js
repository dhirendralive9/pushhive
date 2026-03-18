// Auto-dismiss alerts after 5 seconds
document.querySelectorAll('.alert').forEach(function(alert) {
  setTimeout(function() {
    alert.style.transition = 'opacity 0.3s';
    alert.style.opacity = '0';
    setTimeout(function() { alert.remove(); }, 300);
  }, 5000);
});

// Copy to clipboard
function copyToClipboard(text, btn) {
  navigator.clipboard.writeText(text).then(function() {
    var original = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(function() { btn.textContent = original; }, 2000);
  });
}

// Confirm actions
document.querySelectorAll('[data-confirm]').forEach(function(el) {
  el.addEventListener('click', function(e) {
    if (!confirm(el.getAttribute('data-confirm'))) {
      e.preventDefault();
    }
  });
});
