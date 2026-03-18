// Auto-inject CSRF token into all forms
(function() {
  var csrfMeta = document.querySelector('meta[name="csrf-token"]');
  if (csrfMeta) {
    var token = csrfMeta.getAttribute('content');
    document.querySelectorAll('form[method="POST"], form[method="post"]').forEach(function(form) {
      if (!form.querySelector('input[name="_csrf"]')) {
        var input = document.createElement('input');
        input.type = 'hidden';
        input.name = '_csrf';
        input.value = token;
        form.appendChild(input);
      }
    });
  }
})();

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
