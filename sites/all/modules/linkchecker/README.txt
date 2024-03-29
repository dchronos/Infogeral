
Link Checker
------------

Installation:

1. Place the entire linkchecker folder into your modules directory.
2. Go to Administer -> Site building -> Modules and enable the Link checker module.
3. Go to Administer -> Site configuration -> Link checker and enable the node types to scan.
4. Check all HTML tags that should be scanned.
5. Adjust the other parameters if the defaults don't suit your needs.
6. Save configuration
7. Wait for cron to check all your links... this may take some time! :-)

If links are broken they appear under Administer -> Reports -> Broken links.

If not, make sure the cron is configured and running properly on your Drupal
installation. The Link checker module also logs somewhat useful info about it's
activity under Administer -> Reports -> Recent log entries.


Recommended:

1. For internal URL extraction you need to make sure that Cron always get called
   with your real public site URL (for e.g. http://example.com/cron.php). Make sure
   it's never executed with http://localhost/cron.php or any other hostnames or ports
   not available from public. Otherwise all links may be reported as broken and
   cannot verified as they should be.

   To make sure it always works - it's recommended to configure the $base_url
   in the sites settings.php with your sites URL. Better save than sorry!


Advanced configuration

1. Link checker by default checks 100 links per cron run. This setting can be
   overriden via settings.php. Add the below line to check 200 links per cron
   run. You can lower or higher the limit for your needs if the machine
   can or cannot handle the default number of link checks.

   $conf['linkchecker_check_links_max'] = 200;


Known issues:

1. drupal_http_request() does handle (invalid) non-absolute redirects, http://drupal.org/node/164365
   Until this issue is fixed in core the permanently moved links are not
   automatically updated by the "Update permanently moved links" feature
   to the newly provided URL.
   -> Workaround Manually fix these links or try the patch.
