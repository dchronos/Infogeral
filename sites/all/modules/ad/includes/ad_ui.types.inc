<?php

/**
 * Menu callback: display an overview of available types.
 */
function ad_ui_types_overview() {
  // TODO:
  //drupal_add_css(drupal_get_path('module', 'ad_ui') .'/theme/ad_ui.types.css');

  $header = array(
    t('Name'),
    t('Operations'),
  );

  $rows = array();

  // Loop through all defined ad types.
  foreach (ad_types() as $type => $ad_type) {
    // Build the operation links for the current ad type.
    $links = menu_contextual_links('ad-type', 'admin/ad/types', array($type));

    // Add the ad type's row to the table's rows array.
    $rows[] = array(
      theme('ad_type_admin_overview', array('ad_type' => $ad_type)),
      theme('links', array('links' => $links, 'attributes' => array('class' => 'links operations'))),
    );
  }

  // If no ad types are defined...
  if (empty($rows)) {
    // Add a standard empty row with a link to add a new ad type.
    $rows[] = array(
      array(
        'data' => t('There are no ad types yet. <a href="@link">Add ad type</a>.', array('@link' => url('admin/ad/types/add'))),
        'colspan' => 2,
      )
    );
  }

  return theme('table', array('header' => $header, 'rows' => $rows));
}

/**
 * Builds an overview of an ad type for display to an administrator.
 *
 * @param $variables
 *   An array of variables used to generate the display; by default includes the
 *     type key with a value of the ad type object.
 *
 * @ingroup themeable
 */
function theme_ad_type_admin_overview($variables) {
  $ad_type = $variables['ad_type'];

  $output = check_plain($ad_type->name);
  $output .= ' <small> (Machine name: ' . check_plain($ad_type->type) . ')</small>';
  $output .= '<div class="description">' . filter_xss_admin($ad_type->description) . '</div>';

  return $output;
}

/**
 * Form callback: create or edit a ad type.
 */
function ad_ui_type_form($form, &$form_state, $ad_type) {
  // Store the initial ad type in the form state.
  $form_state['ad_type'] = $ad_type;

  $form['ad_type'] = array(
    '#tree' => TRUE,
  );

  $form['ad_type']['name'] = array(
    '#type' => 'textfield',
    '#title' => t('Name'),
    '#default_value' => $ad_type->name,
    '#description' => t('The human-readable name of this ad type. It is recommended that this name begin with a capital letter and contain only letters, numbers, and spaces. This name must be unique.'),
    '#required' => TRUE,
    '#size' => 32,
    '#field_suffix' => ' <small id="edit-ad-type-name-suffix">' . $ad_type->type . '</small>',
  );

  if (empty($ad_type->type)) {
    $js_settings = array(
      'type' => 'setting',
      'data' => array(
        'machineReadableValue' => array(
          'ad-type-name' => array(
            'text' => t('Machine name'),
            'target' => 'ad-type-type',
            'searchPattern' => '[^a-z0-9]+',
            'replaceToken' => '_',
          ),
        ),
      ),
    );
    $form['ad_type']['type'] = array(
      '#type' => 'textfield',
      '#title' => t('Machine name'),
      '#default_value' => $ad_type->type,
      '#maxlength' => 32,
      '#required' => TRUE,
      '#description' => t('The machine-readable name of this ad type. This name must contain only lowercase letters, numbers, and underscores, it must be unique.'),
      '#attached' => array(
        'js' => array(drupal_get_path('module', 'system') . '/system.js', $js_settings),
      ),
    );
  }

  $form['ad_type']['description'] = array(
    '#type' => 'textarea',
    '#title' => t('Description'),
    '#description' => t('Describe this ad type. The text will be displayed on the <em>Add new content</em> page.'),
    '#default_value' => $ad_type->description,
    '#rows' => 3,
  );

  $form['ad_type']['help'] = array(
    '#type' => 'textarea',
    '#title' => t('Explanation or submission guidelines'),
    '#description' => t('This text will be displayed at the top of the page when creating or editing advertisements of this type.'),
    '#default_value' => $ad_type->help,
    '#rows' => 3,
  );

  $form['actions'] = array('#type' => 'container', '#attributes' => array('class' => array('form-actions')));
  $form['actions']['submit'] = array(
    '#type' => 'submit',
    '#value' => t('Save advertisement type'),
    '#weight' => 40,
  );

  if (!empty($ad_type->type)) {
    $form['actions']['delete'] = array(
      '#type' => 'submit',
      '#value' => t('Delete ad type'),
      '#suffix' => l('Cancel', 'admin/ad/types'),
      '#weight' => 45,
    );
  }
  else {
    $form['actions']['save_continue'] = array(
      '#type' => 'submit',
      '#value' => t('Save and add fields'),
      '#suffix' => l('Cancel', 'admin/ad/types'),
      '#weight' => 45,
    );
  }

  return $form;
}

/**
 * Form submit handler: save an ad type.
 */
function ad_ui_type_form_submit($form, &$form_state) {
  $ad_type = $form_state['ad_type'];
  $updated = !empty($ad_type->type);

  foreach ($form_state['values']['ad_type'] as $key => $value) {
    $ad_type->$key = $value;
  }

  // Write the ad type to the database.
  $ad_type->is_new = !$updated;
  ad_type_save($ad_type);

  // Redirect based on the button clicked.
  drupal_set_message(t('Advertisement type saved.'));

  if ($form_state['clicked_button']['#parents'][0] == 'save_continue') {
    $form_state['redirect'] = 'admin/ad/types/' . $ad_type->type . '/fields';
  }
  else {
    $form_state['redirect'] = 'admin/ad/types';
  }
}

/**
 * Confirmation form for deleting an ad type.
 */
function ad_ui_type_delete_form($form, &$form_state, $ad_type) {
  $form_state['ad_type'] = $ad_type;

  $form = confirm_form($form,
    t('Are you sure you want to delete the %name ad type?', array('%name' => $ad_type->name)),
    'admin/ad/types',
    '<p>' . t('This action cannot be undone.') . '</p>',
    t('Delete'),
    t('Cancel'),
    'confirm'
  );

  return $form;
}

function ad_ui_type_delete_form_submit($form, &$form_state) {
  $ad_type = $form_state['ad_type'];

  ad_type_delete($ad_type->type);

  drupal_set_message(t('The advertisement type %name has been deleted.', array('%name' => $ad_type->name)));
  watchdog('ad', 'Deleted advertisement type %name.', array('%name' => $ad_type->name), WATCHDOG_NOTICE);

  $form_state['redirect'] = 'admin/ad/types';
}
