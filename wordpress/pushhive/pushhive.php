<?php
/**
 * Plugin Name: PushHive — Web Push Notifications
 * Plugin URI: https://github.com/dhirendralive9/pushhive
 * Description: Self-hosted web push notifications powered by PushHive. Collect subscribers and send targeted push notifications from your own server.
 * Version: 2.8.0
 * Author: PushHive
 * Author URI: https://github.com/dhirendralive9/pushhive
 * License: MIT
 * Text Domain: pushhive
 */

if (!defined('ABSPATH')) exit;

define('PUSHHIVE_VERSION', '2.8.0');
define('PUSHHIVE_PLUGIN_DIR', plugin_dir_path(__FILE__));
define('PUSHHIVE_PLUGIN_URL', plugin_dir_url(__FILE__));

// ── Settings ────────────────────────────────────────────────────

function pushhive_register_settings() {
    register_setting('pushhive_settings', 'pushhive_server_url', array(
        'type' => 'string',
        'sanitize_callback' => 'esc_url_raw',
        'default' => ''
    ));
    register_setting('pushhive_settings', 'pushhive_api_key', array(
        'type' => 'string',
        'sanitize_callback' => 'sanitize_text_field',
        'default' => ''
    ));
    register_setting('pushhive_settings', 'pushhive_enabled', array(
        'type' => 'boolean',
        'default' => false
    ));
    register_setting('pushhive_settings', 'pushhive_sw_auto', array(
        'type' => 'boolean',
        'default' => true
    ));
}
add_action('admin_init', 'pushhive_register_settings');

// ── Admin Menu ──────────────────────────────────────────────────

function pushhive_admin_menu() {
    add_options_page(
        'PushHive Settings',
        'PushHive',
        'manage_options',
        'pushhive',
        'pushhive_settings_page'
    );
}
add_action('admin_menu', 'pushhive_admin_menu');

function pushhive_settings_page() {
    $server_url = get_option('pushhive_server_url', '');
    $api_key = get_option('pushhive_api_key', '');
    $enabled = get_option('pushhive_enabled', false);
    $sw_auto = get_option('pushhive_sw_auto', true);
    $sw_exists = file_exists(ABSPATH . 'pushhive-sw.js');
    $connection_ok = false;

    // Test connection if configured
    if ($server_url && $api_key) {
        $test_url = rtrim($server_url, '/') . '/api/config?apiKey=' . urlencode($api_key);
        $response = wp_remote_get($test_url, array('timeout' => 5, 'sslverify' => false));
        if (!is_wp_error($response) && wp_remote_retrieve_response_code($response) === 200) {
            $connection_ok = true;
        }
    }

    ?>
    <div class="wrap">
        <h1>
            <svg width="24" height="24" viewBox="0 0 28 28" fill="none" style="vertical-align:middle;margin-right:8px;">
                <rect width="28" height="28" rx="6" fill="#6366f1"/>
                <path d="M8 14l4 4 8-8" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            PushHive Settings
        </h1>

        <?php if ($server_url && $api_key): ?>
        <div class="notice notice-<?php echo $connection_ok ? 'success' : 'error'; ?> is-dismissible">
            <p>
                <?php if ($connection_ok): ?>
                    ✅ Connected to PushHive server at <strong><?php echo esc_html($server_url); ?></strong>
                <?php else: ?>
                    ❌ Cannot connect to PushHive server. Check your Server URL and API Key.
                <?php endif; ?>
            </p>
        </div>
        <?php endif; ?>

        <?php if ($sw_auto && !$sw_exists && $enabled): ?>
        <div class="notice notice-warning">
            <p>⚠️ Service worker file not found. <a href="<?php echo admin_url('options-general.php?page=pushhive&action=create_sw'); ?>">Click here to create it automatically</a>, or create <code>pushhive-sw.js</code> manually in your WordPress root.</p>
        </div>
        <?php endif; ?>

        <form method="post" action="options.php">
            <?php settings_fields('pushhive_settings'); ?>

            <table class="form-table">
                <tr>
                    <th scope="row">Enable PushHive</th>
                    <td>
                        <label>
                            <input type="checkbox" name="pushhive_enabled" value="1" <?php checked($enabled); ?>>
                            Add PushHive script to all pages
                        </label>
                    </td>
                </tr>
                <tr>
                    <th scope="row">PushHive Server URL</th>
                    <td>
                        <input type="url" name="pushhive_server_url" value="<?php echo esc_attr($server_url); ?>"
                               class="regular-text" placeholder="https://push.yourdomain.com">
                        <p class="description">The URL of your PushHive server (without trailing slash).</p>
                    </td>
                </tr>
                <tr>
                    <th scope="row">Site API Key</th>
                    <td>
                        <input type="text" name="pushhive_api_key" value="<?php echo esc_attr($api_key); ?>"
                               class="regular-text" placeholder="ph_xxxxxxxxxxxx">
                        <p class="description">Find this in your PushHive dashboard under Sites → your site → API Key.</p>
                    </td>
                </tr>
                <tr>
                    <th scope="row">Service Worker</th>
                    <td>
                        <label>
                            <input type="checkbox" name="pushhive_sw_auto" value="1" <?php checked($sw_auto); ?>>
                            Auto-create service worker file
                        </label>
                        <p class="description">
                            <?php if ($sw_exists): ?>
                                ✅ <code>pushhive-sw.js</code> exists at your site root.
                                <a href="<?php echo esc_url(home_url('/pushhive-sw.js')); ?>" target="_blank">Verify →</a>
                            <?php else: ?>
                                ❌ <code>pushhive-sw.js</code> not found at site root.
                            <?php endif; ?>
                        </p>
                    </td>
                </tr>
            </table>

            <?php submit_button('Save Settings'); ?>
        </form>

        <?php if ($connection_ok): ?>
        <hr>
        <h2>Quick Links</h2>
        <p>
            <a href="<?php echo esc_url($server_url . '/dashboard'); ?>" target="_blank" class="button">Open PushHive Dashboard →</a>
            <a href="<?php echo esc_url($server_url . '/dashboard/campaigns/new'); ?>" target="_blank" class="button">New Campaign →</a>
        </p>
        <?php endif; ?>
    </div>
    <?php
}

// ── Handle Service Worker Creation ──────────────────────────────

function pushhive_handle_admin_actions() {
    if (isset($_GET['page']) && $_GET['page'] === 'pushhive' && isset($_GET['action']) && $_GET['action'] === 'create_sw') {
        if (!current_user_can('manage_options')) {
            wp_die('Unauthorized');
        }
        pushhive_create_service_worker();
        wp_redirect(admin_url('options-general.php?page=pushhive&sw_created=1'));
        exit;
    }
}
add_action('admin_init', 'pushhive_handle_admin_actions');

function pushhive_create_service_worker() {
    $server_url = get_option('pushhive_server_url', '');
    if (!$server_url) return false;

    $sw_content = "// PushHive Service Worker — Auto-generated by WordPress plugin\n";
    $sw_content .= "// Do not edit — managed by PushHive plugin\n";
    $sw_content .= "importScripts('" . esc_url(rtrim($server_url, '/')) . "/sdk/pushhive-sw.js');\n";

    $sw_path = ABSPATH . 'pushhive-sw.js';
    $result = file_put_contents($sw_path, $sw_content);

    if ($result === false) {
        add_settings_error('pushhive_settings', 'sw_error', 
            'Could not create service worker file. Please check file permissions on your WordPress root directory, or create the file manually.',
            'error'
        );
        return false;
    }

    return true;
}

// ── Auto-create SW on settings save ─────────────────────────────

function pushhive_on_settings_update($old_value, $new_value, $option) {
    if ($option === 'pushhive_server_url' || $option === 'pushhive_sw_auto') {
        $sw_auto = get_option('pushhive_sw_auto', true);
        $server_url = ($option === 'pushhive_server_url') ? $new_value : get_option('pushhive_server_url', '');
        if ($sw_auto && $server_url) {
            pushhive_create_service_worker();
        }
    }
}
add_action('updated_option', 'pushhive_on_settings_update', 10, 3);

// ── Inject Script into Frontend ─────────────────────────────────

function pushhive_enqueue_script() {
    if (is_admin()) return;

    $enabled = get_option('pushhive_enabled', false);
    if (!$enabled) return;

    $server_url = get_option('pushhive_server_url', '');
    $api_key = get_option('pushhive_api_key', '');

    if (!$server_url || !$api_key) return;

    $script_url = rtrim($server_url, '/') . '/sdk/pushhive.js';

    wp_enqueue_script(
        'pushhive-sdk',
        $script_url,
        array(),
        PUSHHIVE_VERSION,
        true // Load in footer
    );

    // Add data attributes
    wp_script_add_data('pushhive-sdk', 'data-pushhive', 'true');

    // Add inline init script
    wp_add_inline_script('pushhive-sdk',
        'if(window.PushHive){PushHive.init({apiKey:"' . esc_js($api_key) . '"});}',
        'after'
    );
}
add_action('wp_enqueue_scripts', 'pushhive_enqueue_script');

// ── Plugin Activation ───────────────────────────────────────────

function pushhive_activate() {
    // Create service worker if settings exist
    $server_url = get_option('pushhive_server_url', '');
    $sw_auto = get_option('pushhive_sw_auto', true);
    if ($server_url && $sw_auto) {
        pushhive_create_service_worker();
    }
}
register_activation_hook(__FILE__, 'pushhive_activate');

// ── Plugin Deactivation ─────────────────────────────────────────

function pushhive_deactivate() {
    // Optionally remove service worker
    $sw_path = ABSPATH . 'pushhive-sw.js';
    if (file_exists($sw_path)) {
        $content = file_get_contents($sw_path);
        // Only delete if it's our auto-generated file
        if (strpos($content, 'PushHive Service Worker') !== false) {
            unlink($sw_path);
        }
    }
}
register_deactivation_hook(__FILE__, 'pushhive_deactivate');

// ── Settings Link on Plugins Page ───────────────────────────────

function pushhive_plugin_links($links) {
    $settings_link = '<a href="' . admin_url('options-general.php?page=pushhive') . '">Settings</a>';
    array_unshift($links, $settings_link);
    return $links;
}
add_filter('plugin_action_links_' . plugin_basename(__FILE__), 'pushhive_plugin_links');
