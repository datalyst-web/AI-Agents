<?php
/**
 * Plugin Name: Datalyst AI Concierge
 * Plugin URI: https://datalystafrica.com
 * Description: Connects your site to your Datalyst Africa AI chat agent. Sign in with the same email and password you use on your Datalyst dashboard — only existing Datalyst clients can connect, nobody can sign up here.
 * Version: 1.0.0
 * Author: Datalyst Africa
 * Author URI: https://datalystafrica.com
 * License: GPL-2.0-or-later
 * Text Domain: datalyst-ai-concierge
 *
 * Sign-in credentials are the SAME ones a client already has for the
 * Datalyst Africa dashboard (see apps/api/src/routes/wordpressConnect.routes.ts)
 * — this plugin never lets a visitor create a new account, and the
 * password is only ever sent once, at connect time, to verify identity and
 * fetch the client's own agent list. Nothing is stored here afterward
 * except the chosen Agent ID and widget position — both non-secret, the
 * same two values a manually-pasted embed snippet would carry.
 */

if (!defined('ABSPATH')) {
	exit; // No direct access.
}

define('DATALYST_AI_CONCIERGE_WIDGET_SCRIPT_URL', 'https://app.datalystafrica.com/widget.js');
define('DATALYST_AI_CONCIERGE_API_BASE_URL', 'https://api.datalystafrica.com');
define('DATALYST_AI_CONCIERGE_AGENT_ID_OPTION', 'datalyst_ai_concierge_agent_id');
define('DATALYST_AI_CONCIERGE_AGENT_NAME_OPTION', 'datalyst_ai_concierge_agent_name');
define('DATALYST_AI_CONCIERGE_POSITION_OPTION', 'datalyst_ai_concierge_position');
define('DATALYST_AI_CONCIERGE_AGENTS_TRANSIENT', 'datalyst_ai_concierge_pending_agents');
define('DATALYST_AI_CONCIERGE_VERSION', '1.0.0');

/**
 * Renders the embed <script> tag in the site footer — same shape as the
 * "Website embed" snippet on the client's own dashboard, just placed here
 * automatically. Nothing prints until an agent has actually been chosen.
 */
function datalyst_ai_concierge_render_widget() {
	$agent_id = get_option(DATALYST_AI_CONCIERGE_AGENT_ID_OPTION, '');
	if (empty($agent_id)) {
		return;
	}
	$position = get_option(DATALYST_AI_CONCIERGE_POSITION_OPTION, 'right');
	if (!in_array($position, array('left', 'right'), true)) {
		$position = 'right';
	}
	printf(
		'<script src="%1$s" data-agent-id="%2$s" data-api-base="%3$s" data-position="%4$s"></script>' . "\n",
		esc_url(DATALYST_AI_CONCIERGE_WIDGET_SCRIPT_URL),
		esc_attr($agent_id),
		esc_url(DATALYST_AI_CONCIERGE_API_BASE_URL),
		esc_attr($position)
	);
}
add_action('wp_footer', 'datalyst_ai_concierge_render_widget');

function datalyst_ai_concierge_add_settings_page() {
	add_options_page(
		__('Datalyst AI Concierge', 'datalyst-ai-concierge'),
		__('Datalyst AI Concierge', 'datalyst-ai-concierge'),
		'manage_options',
		'datalyst-ai-concierge',
		'datalyst_ai_concierge_render_settings_page'
	);
}
add_action('admin_menu', 'datalyst_ai_concierge_add_settings_page');

/**
 * Step 1: verify the client's dashboard credentials against our API and
 * fetch their agent list. The password is used once, right here, and
 * never written to the database — only the returned agent list goes into
 * a short-lived transient so step 2 (choosing an agent) can read it back
 * without asking the client to sign in twice.
 */
function datalyst_ai_concierge_handle_connect_submit() {
	if (!isset($_POST['datalyst_ai_concierge_connect_nonce'])) {
		return;
	}
	check_admin_referer('datalyst_ai_concierge_connect', 'datalyst_ai_concierge_connect_nonce');
	if (!current_user_can('manage_options')) {
		return;
	}

	$email = isset($_POST['datalyst_email']) ? sanitize_email(wp_unslash($_POST['datalyst_email'])) : '';
	$password = isset($_POST['datalyst_password']) ? (string) wp_unslash($_POST['datalyst_password']) : '';

	if (empty($email) || empty($password)) {
		add_settings_error('datalyst_ai_concierge', 'missing_fields', __('Enter both your email and password.', 'datalyst-ai-concierge'));
		return;
	}

	$response = wp_remote_post(DATALYST_AI_CONCIERGE_API_BASE_URL . '/v1/integrations/wordpress/connect', array(
		'timeout' => 15,
		'headers' => array('Content-Type' => 'application/json'),
		'body' => wp_json_encode(array('email' => $email, 'password' => $password)),
	));

	// $password only ever lived in this local variable and the request body
	// above — never assigned anywhere it could be persisted or logged.
	unset($password);

	if (is_wp_error($response)) {
		add_settings_error('datalyst_ai_concierge', 'connect_failed', __('Could not reach Datalyst Africa — please try again in a moment.', 'datalyst-ai-concierge'));
		return;
	}

	$code = wp_remote_retrieve_response_code($response);
	$data = json_decode(wp_remote_retrieve_body($response), true);

	if (401 === $code) {
		add_settings_error('datalyst_ai_concierge', 'invalid_credentials', __('That email or password isn\'t right — use the same login you use on your Datalyst Africa dashboard.', 'datalyst-ai-concierge'));
		return;
	}
	if (403 === $code) {
		add_settings_error('datalyst_ai_concierge', 'not_a_client', __('This looks like a Datalyst staff account, not a client account — sign in with your business\'s own dashboard login instead.', 'datalyst-ai-concierge'));
		return;
	}
	if (200 !== $code || empty($data['agents']) || !is_array($data['agents'])) {
		add_settings_error('datalyst_ai_concierge', 'no_agents', __('Signed in, but no agents were found on your account yet — set one up on your Datalyst dashboard first.', 'datalyst-ai-concierge'));
		return;
	}

	// 10 minutes is plenty to pick an agent on the very next page load; short
	// on purpose so a half-finished connect attempt doesn't linger.
	set_transient(DATALYST_AI_CONCIERGE_AGENTS_TRANSIENT, array(
		'tenant_name' => isset($data['tenantName']) ? sanitize_text_field($data['tenantName']) : '',
		'agents' => $data['agents'],
	), 10 * MINUTE_IN_SECONDS);
}
add_action('admin_init', 'datalyst_ai_concierge_handle_connect_submit');

/**
 * Step 2: save the chosen agent + widget position as the plugin's only
 * persisted settings, and clear the pending-agents transient from step 1.
 */
function datalyst_ai_concierge_handle_choose_submit() {
	if (!isset($_POST['datalyst_ai_concierge_choose_nonce'])) {
		return;
	}
	check_admin_referer('datalyst_ai_concierge_choose', 'datalyst_ai_concierge_choose_nonce');
	if (!current_user_can('manage_options')) {
		return;
	}

	$pending = get_transient(DATALYST_AI_CONCIERGE_AGENTS_TRANSIENT);
	$agent_id = isset($_POST['datalyst_agent_id']) ? sanitize_text_field(wp_unslash($_POST['datalyst_agent_id'])) : '';
	$position = isset($_POST['datalyst_position']) && 'left' === $_POST['datalyst_position'] ? 'left' : 'right';

	$chosen_name = '';
	if (is_array($pending) && !empty($pending['agents'])) {
		foreach ($pending['agents'] as $agent) {
			if (isset($agent['id']) && $agent['id'] === $agent_id) {
				$chosen_name = isset($agent['name']) ? $agent['name'] : '';
				break;
			}
		}
	}

	if (empty($agent_id) || empty($chosen_name)) {
		add_settings_error('datalyst_ai_concierge', 'invalid_agent', __('Please choose one of the agents listed below.', 'datalyst-ai-concierge'));
		return;
	}

	update_option(DATALYST_AI_CONCIERGE_AGENT_ID_OPTION, $agent_id);
	update_option(DATALYST_AI_CONCIERGE_AGENT_NAME_OPTION, sanitize_text_field($chosen_name));
	update_option(DATALYST_AI_CONCIERGE_POSITION_OPTION, $position);
	delete_transient(DATALYST_AI_CONCIERGE_AGENTS_TRANSIENT);

	add_settings_error('datalyst_ai_concierge', 'connected', __('Connected! Your chat widget is now live on your site.', 'datalyst-ai-concierge'), 'success');
}
add_action('admin_init', 'datalyst_ai_concierge_handle_choose_submit');

function datalyst_ai_concierge_handle_disconnect() {
	if (!isset($_POST['datalyst_ai_concierge_disconnect_nonce'])) {
		return;
	}
	check_admin_referer('datalyst_ai_concierge_disconnect', 'datalyst_ai_concierge_disconnect_nonce');
	if (!current_user_can('manage_options')) {
		return;
	}
	delete_option(DATALYST_AI_CONCIERGE_AGENT_ID_OPTION);
	delete_option(DATALYST_AI_CONCIERGE_AGENT_NAME_OPTION);
	delete_option(DATALYST_AI_CONCIERGE_POSITION_OPTION);
	delete_transient(DATALYST_AI_CONCIERGE_AGENTS_TRANSIENT);
}
add_action('admin_init', 'datalyst_ai_concierge_handle_disconnect');

function datalyst_ai_concierge_render_settings_page() {
	if (!current_user_can('manage_options')) {
		return;
	}

	$connected_agent_id = get_option(DATALYST_AI_CONCIERGE_AGENT_ID_OPTION, '');
	$connected_agent_name = get_option(DATALYST_AI_CONCIERGE_AGENT_NAME_OPTION, '');
	$connected_position = get_option(DATALYST_AI_CONCIERGE_POSITION_OPTION, 'right');
	$pending = get_transient(DATALYST_AI_CONCIERGE_AGENTS_TRANSIENT);
	?>
	<div class="wrap">
		<h1><?php esc_html_e('Datalyst AI Concierge', 'datalyst-ai-concierge'); ?></h1>
		<?php settings_errors('datalyst_ai_concierge'); ?>

		<?php if (!empty($connected_agent_id)) : ?>

			<div class="notice notice-success inline">
				<p>
					<?php
					printf(
						/* translators: 1: agent name, 2: bottom-left or bottom-right */
						esc_html__('Connected to "%1$s" — the widget appears in the bottom-%2$s corner of your site.', 'datalyst-ai-concierge'),
						esc_html($connected_agent_name),
						esc_html($connected_position)
					);
					?>
				</p>
			</div>
			<form action="" method="post">
				<?php wp_nonce_field('datalyst_ai_concierge_disconnect', 'datalyst_ai_concierge_disconnect_nonce'); ?>
				<?php submit_button(__('Disconnect', 'datalyst-ai-concierge'), 'delete'); ?>
			</form>

		<?php elseif (is_array($pending) && !empty($pending['agents'])) : ?>

			<p>
				<?php
				printf(
					/* translators: %s: tenant/business name */
					esc_html__('Signed in as %s. Choose which agent to show on this site, and where the widget should sit.', 'datalyst-ai-concierge'),
					esc_html($pending['tenant_name'])
				);
				?>
			</p>
			<form action="" method="post">
				<?php wp_nonce_field('datalyst_ai_concierge_choose', 'datalyst_ai_concierge_choose_nonce'); ?>
				<table class="form-table" role="presentation">
					<tr>
						<th scope="row"><?php esc_html_e('Agent', 'datalyst-ai-concierge'); ?></th>
						<td>
							<fieldset>
								<?php foreach ($pending['agents'] as $agent) :
									if (empty($agent['id'])) {
										continue;
									}
									?>
									<label style="display:block;margin-bottom:6px;">
										<input type="radio" name="datalyst_agent_id" value="<?php echo esc_attr($agent['id']); ?>" />
										<?php echo esc_html(isset($agent['name']) ? $agent['name'] : $agent['id']); ?>
										<?php if (!empty($agent['status'])) : ?>
											<span class="description">(<?php echo esc_html(strtolower(str_replace('_', ' ', $agent['status']))); ?>)</span>
										<?php endif; ?>
									</label>
								<?php endforeach; ?>
							</fieldset>
						</td>
					</tr>
					<tr>
						<th scope="row"><?php esc_html_e('Widget position', 'datalyst-ai-concierge'); ?></th>
						<td>
							<label style="margin-right:16px;"><input type="radio" name="datalyst_position" value="right" checked="checked" /> <?php esc_html_e('Bottom right', 'datalyst-ai-concierge'); ?></label>
							<label><input type="radio" name="datalyst_position" value="left" /> <?php esc_html_e('Bottom left', 'datalyst-ai-concierge'); ?></label>
						</td>
					</tr>
				</table>
				<?php submit_button(__('Connect this agent', 'datalyst-ai-concierge')); ?>
			</form>

		<?php else : ?>

			<p><?php esc_html_e('Sign in with the same email and password you use on your Datalyst Africa dashboard. Only existing Datalyst clients can connect here — this does not create a new account.', 'datalyst-ai-concierge'); ?></p>
			<form action="" method="post">
				<?php wp_nonce_field('datalyst_ai_concierge_connect', 'datalyst_ai_concierge_connect_nonce'); ?>
				<table class="form-table" role="presentation">
					<tr>
						<th scope="row"><label for="datalyst_email"><?php esc_html_e('Email', 'datalyst-ai-concierge'); ?></label></th>
						<td><input type="email" id="datalyst_email" name="datalyst_email" class="regular-text" autocomplete="off" required="required" /></td>
					</tr>
					<tr>
						<th scope="row"><label for="datalyst_password"><?php esc_html_e('Password', 'datalyst-ai-concierge'); ?></label></th>
						<td><input type="password" id="datalyst_password" name="datalyst_password" class="regular-text" autocomplete="off" required="required" /></td>
					</tr>
				</table>
				<?php submit_button(__('Sign in', 'datalyst-ai-concierge')); ?>
			</form>

		<?php endif; ?>
	</div>
	<?php
}

function datalyst_ai_concierge_settings_link($links) {
	$settings_link = '<a href="' . esc_url(admin_url('options-general.php?page=datalyst-ai-concierge')) . '">' . esc_html__('Settings', 'datalyst-ai-concierge') . '</a>';
	array_unshift($links, $settings_link);
	return $links;
}
add_filter('plugin_action_links_' . plugin_basename(__FILE__), 'datalyst_ai_concierge_settings_link');
