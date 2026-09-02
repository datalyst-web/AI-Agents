=== Datalyst AI Concierge ===
Contributors: datalystafrica
Tags: chatbot, ai, chat widget, customer support
Requires at least: 5.0
Tested up to: 6.6
Requires PHP: 7.2
Stable tag: 1.0.0
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Connects your site to your Datalyst Africa AI chat agent — sign in with your existing Datalyst dashboard login, pick an agent, and you're done.

== Description ==

This plugin adds your Datalyst Africa AI chat widget to every page of your site. You don't edit any code — you sign in with the same email and password you already use on your Datalyst Africa dashboard, choose which of your agents to show, and pick whether the widget sits in the bottom-left or bottom-right corner.

Only existing Datalyst Africa clients can connect through this plugin — it never lets a site visitor create a new account.

== Installation ==

1. In your WordPress admin, go to **Plugins → Add New → Upload Plugin**.
2. Choose the `datalyst-ai-concierge.zip` file you downloaded and click **Install Now**.
3. Click **Activate**.
4. Go to **Settings → Datalyst AI Concierge**.
5. Sign in with your Datalyst Africa dashboard email and password.
6. Choose which agent to connect and where the widget should sit.
7. Click **Connect this agent**. Visit your site — the chat widget should now appear.

== Frequently Asked Questions ==

= What credentials do I sign in with? =

The exact same email and password you use to log in to your Datalyst Africa dashboard. This plugin does not create a separate account — if you don't already have a Datalyst Africa account, this plugin can't help you (contact Datalyst Africa to get set up first).

= Is my password stored anywhere? =

No. It's sent once, directly to Datalyst Africa's servers, to verify who you are and list your agents — the plugin never writes it to your site's database.

= Can I change which agent is connected, or the widget position? =

Yes — click **Disconnect** on the settings page, then sign in and choose again.

= Does this slow down my site? =

No — the widget loads asynchronously and only after the rest of your page has loaded.

== Changelog ==

= 1.0.0 =
* Initial release — dashboard sign-in, agent picker, left/right widget position.
