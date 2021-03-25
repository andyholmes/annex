
appstream_file = i18n.merge_file(
        input: 'ca.andyholmes.Annex.appdata.xml.in',
       output: 'ca.andyholmes.Annex.appdata.xml',
       po_dir: podir,
      install: true,
  install_dir: join_paths(datadir, 'appdata')
)

appstream_util = find_program('appstream-util', required: false)
if appstream_util.found()
  test('Validate appstream file', appstream_util,
    args: ['validate', appstream_file]
  )
endif

