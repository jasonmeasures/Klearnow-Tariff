<?php
/**
 * Plugin Name: KlearNow Duty Stack
 * Description: Embeds the KlearNow Tariff Duty stack (external surface) via shortcode for WordPress.
 * Version: 1.1.0
 * Author: KlearNow
 *
 * Usage: [klearnow_duty_stack height="720"]
 * Optional: url="https://tariff.example.com/?embed=1&surface=external"
 */

if (!defined('ABSPATH')) {
  exit;
}

define('KN_DUTY_STACK_DEFAULT_URL', 'https://tariff.klearnow.com/?embed=1&surface=external');

function kn_duty_stack_shortcode($atts) {
  $a = shortcode_atts([
    'url' => get_option('kn_duty_stack_url', KN_DUTY_STACK_DEFAULT_URL),
    'height' => '900',
    'title' => 'KlearNow Duty stack',
  ], $atts, 'klearnow_duty_stack');

  $url = esc_url($a['url']);
  $height = preg_replace('/[^0-9%]/', '', (string) $a['height']) ?: '720';
  $title = esc_attr($a['title']);

  return sprintf(
    '<div class="kn-duty-stack-embed" style="position:relative;width:100%%;min-height:%1$spx">'
    . '<iframe src="%2$s" title="%3$s" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" '
    . 'style="border:0;width:100%%;height:%1$spx;border-radius:12px;background:#003F5B" '
    . 'allow="clipboard-write"></iframe></div>',
    esc_attr($height),
    $url,
    $title
  );
}
add_shortcode('klearnow_duty_stack', 'kn_duty_stack_shortcode');
add_shortcode('klearnow_tariff_simulator', 'kn_duty_stack_shortcode'); // legacy alias

function kn_duty_stack_admin_menu() {
  add_options_page(
    'KlearNow Duty Stack',
    'KlearNow Duty Stack',
    'manage_options',
    'kn-duty-stack',
    'kn_duty_stack_settings_page'
  );
}
add_action('admin_menu', 'kn_duty_stack_admin_menu');

function kn_duty_stack_settings_page() {
  if (!current_user_can('manage_options')) {
    return;
  }
  if (isset($_POST['kn_duty_stack_url']) && check_admin_referer('kn_duty_stack_save')) {
    update_option('kn_duty_stack_url', esc_url_raw(wp_unslash($_POST['kn_duty_stack_url'])));
    echo '<div class="updated"><p>Saved.</p></div>';
  }
  $url = get_option('kn_duty_stack_url', KN_DUTY_STACK_DEFAULT_URL);
  ?>
  <div class="wrap">
    <h1>KlearNow Duty Stack</h1>
    <p>Paste <code>[klearnow_duty_stack]</code> on any page. External visitors get the Duty stack only (no admin), with <strong>5 stacks / 2 extracts per day</strong> until they sign in — signed-in users are unlimited.</p>
    <form method="post">
      <?php wp_nonce_field('kn_duty_stack_save'); ?>
      <table class="form-table">
        <tr>
          <th scope="row"><label for="kn_duty_stack_url">Embed URL</label></th>
          <td>
            <input type="url" class="regular-text" id="kn_duty_stack_url" name="kn_duty_stack_url"
              value="<?php echo esc_attr($url); ?>" />
            <p class="description">Must include <code>embed=1&amp;surface=external</code>. Backend <code>FRAME_ANCESTORS</code> must allow this WordPress origin.</p>
          </td>
        </tr>
      </table>
      <?php submit_button('Save'); ?>
    </form>
  </div>
  <?php
}
