<?php

/**
 * Menu callback: display a list of ad types that the user can create.
 */
function ad_ui_add_page() {
  $item = menu_get_item();
  $content = system_admin_menu_block($item);

  // Bypass the admin/ad/add listing if only one ad type is available.
  if (count($content) == 1) {
    $item = array_shift($content);
    drupal_goto($item['href']);
  }

  return theme('ad_add_list', array('content' => $content));
}

/**
 * Display the list of available ad types for ad creation.
 *
 * @ingroup themeable
 */
function theme_ad_add_list($variables) {
  $content = $variables['content'];
  $output = '';

  if ($content) {
    $output = '<dl class="ad-type-list">';
    foreach ($content as $item) {
      $output .= '<dt>' . l($item['title'], $item['href'], $item['localized_options']) . '</dt>';
      $output .= '<dd>' . filter_xss_admin($item['description']) . '</dd>';
    }
    $output .= '</dl>';
  }
  else {
    if (user_access('administer ad types')) {
      $output = '<p>' . t('You have not created any ad types yet. Go to the <a href="@create-ad-type">ad type creation page</a> to add a new ad type.', array('@create-ad-type' => url('admin/ad/types/add'))) . '</p>';
    }
    else {
      $output = '<p>' . t('No ad types have been created yet for you to use.') . '</p>';
    }
  }

  return $output;
}

/**
 * Form callback: create or edit an ad.
 */
function ad_ui_form($form, &$form_state, $ad) {
  $form = array();

  // Add the default field elements.
  // TODO: Update description to include the acceptable ad tokens.
  $form['title'] = array(
    '#type' => 'textfield',
    '#title' => t('Title'),
    '#default_value' => $ad->title,
    '#maxlength' => 255,
    '#required' => TRUE,
    '#weight' => -5,
  );

  // Add the field related form elements.
  $form_state['ad'] = $ad;
  field_attach_form('ad', $ad, $form, $form_state);

  $form['status'] = array(
    '#type' => 'radios',
    '#title' => t('Status'),
    '#description' => t('TODO.'),
    '#options' => array(
      '1' => t('Active'),
      '0' => t('Disabled'),
    ),
    '#default_value' => $ad->status,
    '#required' => TRUE,
    '#weight' => 35,
  );

  $form['actions'] = array(
    '#type' => 'container',
    '#attributes' => array('class' => array('form-actions')),
    '#weight' => 40,
  );
  $form['actions']['submit'] = array(
    '#type' => 'submit',
    '#value' => t('Save advertisement'),
  );

  // Add the save and continue button for new ads.
  if (empty($ad->aid)) {
    $form['actions']['save_continue'] = array(
      '#type' => 'submit',
      '#value' => t('Save and add another'),
      '#suffix' => l('Cancel', 'admin/ad'),
      '#weight' => 45,
    );
  }
  else {
    $form['actions']['submit']['#suffix'] = l('Cancel', 'admin/ad');
  }

  return $form;
}

/**
 * Validation callback for ad_ui_form().
 */
function ad_ui_form_validate($form, &$form_state) {
  $ad = $form_state['ad'];

  // Notify field widgets to validate their data.
  field_attach_form_validate('ad', $ad, $form, $form_state);
}

/**
 * Submit callback for ad_ui_form().
 */
function ad_ui_form_submit($form, &$form_state) {
  global $user;

  $ad = &$form_state['ad'];

  // Save default parameters back into the $ad object.
  $ad->title = $form_state['values']['title'];
  $ad->status = $form_state['values']['status'];

  // Set the ad's uid if it's being created at this time.
  if (empty($ad->aid)) {
    $ad->uid = $ad->uid;
  }

  // Notify field widgets.
  field_attach_submit('ad', $ad, $form, $form_state);

  // Save the ad.
  ad_save($ad);

  // Redirect based on the button clicked.
  drupal_set_message(t('Advertisement saved.'));

  if ($form_state['clicked_button']['#parents'][0] == 'save_continue') {
    $form_state['redirect'] = 'admin/ad/add/' . $ad->type;
  }
  else {
    $form_state['redirect'] = 'admin/ad';
  }
}

/**
 * Confirmation form for deleting an ad.
 */
function ad_ui_delete_form($form, &$form_state, $ad) {
  $form_state['ad'] = $ad;

  $form = confirm_form($form,
    t('Are you sure you want to delete %title?', array('%title' => $ad->title)),
    'admin/ad',
    '<p>' . t('Deleting this advertisement cannot be undone.') . '</p>',
    t('Delete'),
    t('Cancel'),
    'confirm'
  );

  return $form;
}

/**
 * Submit callback for ad_ui_delete_form().
 */
function ad_ui_delete_form_submit($form, &$form_state) {
  $ad = $form_state['ad'];

  if (ad_delete($ad->aid)) {
    drupal_set_message(t('%title has been deleted.', array('%title' => $ad->title)));
    watchdog('ad', 'Deleted ad %title.', array('%title' => $ad->title), WATCHDOG_NOTICE);
  }

  $form_state['redirect'] = 'admin/ad';
}

