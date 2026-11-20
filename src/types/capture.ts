/** Per-capture presentation settings; never apply them to source frames used for stitching. */
export interface CaptureAppearance {
  rounded: boolean
  radius: number
  shell: string
}
